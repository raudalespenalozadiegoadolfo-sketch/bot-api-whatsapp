#!/usr/bin/env node

const { MongoClient } = require("mongodb");
const { convertLegacyEntry, RECORD_STATUS } = require("../services/legacyOrderBackfillService");

const INDEX_NAME = "tenantId_1_legacySource.type_1_legacySource.customerId_1_legacySource.legacyEntryId_1";
const INDEX_KEYS = Object.freeze({
  tenantId: 1,
  "legacySource.type": 1,
  "legacySource.customerId": 1,
  "legacySource.legacyEntryId": 1,
});
const PARTIAL_FILTER = Object.freeze({
  "legacySource.type": "cliente_historial",
  "legacySource.legacyEntryId": { $type: "string" },
});
const GENERIC_ERROR_MESSAGE = "No fue posible auditar produccion; los detalles internos fueron omitidos.";

class SafeAuditError extends Error {
  constructor(code, stage) {
    super(GENERIC_ERROR_MESSAGE);
    this.name = "SafeAuditError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage) {
  throw new SafeAuditError(code, stage);
}

function parseArguments(args) {
  if (args.some(arg => ["--apply", "--create", "--delete"].some(blocked =>
    arg === blocked || arg.startsWith(`${blocked}=`)))) {
    fail("FORBIDDEN_ARGUMENT", "LOCAL_VALIDATION");
  }
  const source = args.filter(arg => arg.startsWith("--source-environment="));
  const database = args.filter(arg => arg.startsWith("--database="));
  if (args.some(arg => !arg.startsWith("--source-environment=") && !arg.startsWith("--database=")) ||
      source.length !== 1 || database.length !== 1) {
    fail("INVALID_ARGUMENT", "LOCAL_VALIDATION");
  }
  if (source[0] !== "--source-environment=production") {
    fail("WRONG_ENVIRONMENT", "LOCAL_VALIDATION");
  }
  const databaseName = database[0].slice("--database=".length);
  if (!databaseName || !/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    fail("INVALID_DATABASE_NAME", "LOCAL_VALIDATION");
  }
  return { databaseName };
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function legacyIndexStatus(indexes) {
  const candidates = indexes.filter(index => index.name === INDEX_NAME || sameDocument(index.key, INDEX_KEYS));
  if (!candidates.length) return "MISSING";
  const compatible = index => sameDocument(index.key, INDEX_KEYS) && index.unique === true &&
    sameDocument(index.partialFilterExpression, PARTIAL_FILTER);
  return candidates.every(compatible) ? "READY" : "INCOMPATIBLE";
}

async function collectionExists(db, name) {
  const collections = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return collections.some(collection => collection.name === name);
}

async function auditDatabase(db, expectedDatabaseName) {
  if (db?.databaseName !== expectedDatabaseName) fail("WRONG_DATABASE", "DATABASE_VERIFICATION");

  const clientesExists = await collectionExists(db, "clientes");
  const ordersCollectionExists = await collectionExists(db, "orders");
  let clientesConHistorial = 0;
  let scannedEntries = 0;
  let blockedCount = 0;
  let migratableCount = 0;

  if (clientesExists) {
    const cursor = db.collection("clientes").find(
      { historialPedidos: { $exists: true, $ne: [] } },
      { projection: { _id: 1, tenantId: 1, branchId: 1, historialPedidos: 1 } }
    );
    for await (const customer of cursor) {
      clientesConHistorial += 1;
      if (!Array.isArray(customer.historialPedidos)) continue;
      for (const entry of customer.historialPedidos) {
        scannedEntries += 1;
        const conversion = convertLegacyEntry(customer, entry);
        if (conversion.status === RECORD_STATUS.READY) migratableCount += 1;
        else blockedCount += 1;
      }
    }
  }

  let legacyOrdersActuales = 0;
  let indexStatus = "MISSING";
  if (ordersCollectionExists) {
    const orders = db.collection("orders");
    legacyOrdersActuales = await orders.countDocuments({ "legacySource.type": "cliente_historial" });
    indexStatus = legacyIndexStatus(await orders.listIndexes().toArray());
  }

  return {
    database: expectedDatabaseName,
    clientesConHistorial,
    scannedEntries,
    legacyOrdersActuales,
    ordersCollectionExists,
    legacyIndexStatus: indexStatus,
    blockedCount,
    migratableCount,
  };
}

async function auditConnectedClient(client, databaseName) {
  const db = client.db(databaseName);
  if (db?.databaseName !== databaseName) fail("WRONG_DATABASE", "DATABASE_VERIFICATION");
  return auditDatabase(db, databaseName);
}

function classifyError(error, stage) {
  if (error instanceof SafeAuditError) return error;
  if (error?.code === 18 || error?.codeName === "AuthenticationFailed") return new SafeAuditError("AUTH_FAILED", stage);
  if (error?.code === 13 || error?.codeName === "Unauthorized") return new SafeAuditError("PERMISSION_DENIED", stage);
  if (["MongoNetworkError", "MongoServerSelectionError", "MongoTopologyClosedError"].includes(error?.name) ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(String(error?.code || ""))) {
    return new SafeAuditError("NETWORK_ERROR", stage);
  }
  return new SafeAuditError("AUDIT_FAILED", stage);
}

function safeDiagnostic(error, stage) {
  const safe = classifyError(error, stage);
  return { ok: false, code: safe.code, stage: safe.stage, message: GENERIC_ERROR_MESSAGE };
}

async function main(args = process.argv.slice(2), environment = process.env) {
  let client = null;
  let stage = "LOCAL_VALIDATION";
  try {
    const { databaseName } = parseArguments(args);
    const uri = environment.PRODUCTION_MONGO_URI;
    if (!uri) fail("MISSING_PRODUCTION_URI", stage);
    stage = "CONNECTION";
    client = new MongoClient(uri);
    await client.connect();
    stage = "DATABASE_VERIFICATION";
    stage = "AUDIT";
    console.log(JSON.stringify({ ok: true, ...(await auditConnectedClient(client, databaseName)) }));
  } catch (error) {
    throw classifyError(error, stage);
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify(safeDiagnostic(error)));
    process.exitCode = 1;
  });
}

module.exports = {
  GENERIC_ERROR_MESSAGE, INDEX_KEYS, INDEX_NAME, PARTIAL_FILTER, SafeAuditError,
  auditConnectedClient, auditDatabase, classifyError, legacyIndexStatus, parseArguments, safeDiagnostic,
};
