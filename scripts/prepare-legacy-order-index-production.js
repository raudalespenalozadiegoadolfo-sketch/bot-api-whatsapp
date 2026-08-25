#!/usr/bin/env node

const { MongoClient } = require("mongodb");

const COLLECTION_NAME = "orders";
const INDEX_NAME = "tenantId_1_legacySource.type_1_legacySource.customerId_1_legacySource.legacyEntryId_1";
const REQUIRED_CONFIRMATION = "CREATE_LEGACY_ORDER_INDEX_IN_PRODUCTION";
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
const GENERIC_ERROR_MESSAGE = "No fue posible preparar el indice; los detalles internos fueron omitidos.";

class SafeIndexError extends Error {
  constructor(code, stage) {
    super(GENERIC_ERROR_MESSAGE);
    this.name = "SafeIndexError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage) {
  throw new SafeIndexError(code, stage);
}

function parseArguments(args) {
  if (args.some(arg => ["--apply", "--delete"].some(blocked =>
    arg === blocked || arg.startsWith(`${blocked}=`)))) {
    fail("FORBIDDEN_ARGUMENT", "LOCAL_VALIDATION");
  }
  const destination = args.filter(arg => arg.startsWith("--destination-environment="));
  const database = args.filter(arg => arg.startsWith("--database="));
  const confirmation = args.filter(arg => arg.startsWith("--confirm="));
  const creates = args.filter(arg => arg === "--create");
  const known = args.every(arg => arg === "--create" ||
    arg.startsWith("--destination-environment=") || arg.startsWith("--database=") ||
    arg.startsWith("--confirm="));
  if (!known || destination.length !== 1 || database.length !== 1 ||
      confirmation.length > 1 || creates.length > 1) {
    fail("INVALID_ARGUMENT", "LOCAL_VALIDATION");
  }
  if (destination[0] !== "--destination-environment=production") {
    fail("WRONG_ENVIRONMENT", "LOCAL_VALIDATION");
  }
  const databaseName = database[0].slice("--database=".length);
  if (!databaseName || !/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    fail("INVALID_DATABASE_NAME", "LOCAL_VALIDATION");
  }
  const create = creates.length === 1;
  const confirmed = confirmation[0] === `--confirm=${REQUIRED_CONFIRMATION}`;
  if (create !== confirmed) fail("CONFIRMATION_REQUIRED", "LOCAL_VALIDATION");
  return { create, databaseName };
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCompatible(index) {
  return sameDocument(index.key, INDEX_KEYS) && index.unique === true &&
    sameDocument(index.partialFilterExpression, PARTIAL_FILTER);
}

function inspectIndexes(indexes) {
  const candidates = indexes.filter(index =>
    index.name === INDEX_NAME || sameDocument(index.key, INDEX_KEYS));
  if (!candidates.length) return { status: "MISSING" };
  if (candidates.some(index => !isCompatible(index))) {
    fail("INCOMPATIBLE_INDEX", "INDEX_AUDIT");
  }
  return { status: "READY", name: candidates[0].name };
}

async function listIndexes(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

async function prepareIndex(db, { create }) {
  const collection = db.collection(COLLECTION_NAME);
  const before = inspectIndexes(await listIndexes(collection));
  if (before.status === "READY" || !create) {
    return { mode: create ? "CREATE" : "DRY_RUN", ...before };
  }
  await collection.createIndex(INDEX_KEYS, {
    name: INDEX_NAME,
    unique: true,
    partialFilterExpression: PARTIAL_FILTER,
  });
  const after = inspectIndexes(await listIndexes(collection));
  if (after.status !== "READY") fail("VERIFICATION_FAILED", "POST_CREATE_VERIFICATION");
  return { mode: "CREATE", status: "CREATED", name: after.name };
}

async function prepareConnectedClient(client, databaseName, options) {
  const db = client.db(databaseName);
  if (db?.databaseName !== databaseName) fail("WRONG_DATABASE", "DATABASE_VERIFICATION");
  return prepareIndex(db, options);
}

function classifyError(error, stage) {
  if (error instanceof SafeIndexError) return error;
  if (error?.code === 18 || error?.codeName === "AuthenticationFailed") return new SafeIndexError("AUTH_FAILED", stage);
  if (error?.code === 13 || error?.codeName === "Unauthorized") return new SafeIndexError("PERMISSION_DENIED", stage);
  if (["MongoNetworkError", "MongoServerSelectionError", "MongoTopologyClosedError"].includes(error?.name) ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(String(error?.code || ""))) {
    return new SafeIndexError("NETWORK_ERROR", stage);
  }
  if (stage === "INDEX_CREATE") return new SafeIndexError("CREATE_FAILED", stage);
  return new SafeIndexError("UNKNOWN_ERROR", stage);
}

function safeDiagnostic(error, stage) {
  const safe = classifyError(error, stage);
  return { ok: false, code: safe.code, stage: safe.stage, message: GENERIC_ERROR_MESSAGE };
}

async function main(args = process.argv.slice(2), environment = process.env) {
  let client = null;
  let stage = "LOCAL_VALIDATION";
  try {
    const options = parseArguments(args);
    const uri = environment.PRODUCTION_MONGO_URI;
    if (!uri) fail("MISSING_PRODUCTION_URI", stage);
    stage = "CONNECTION";
    client = new MongoClient(uri);
    await client.connect();
    stage = options.create ? "INDEX_CREATE" : "INDEX_AUDIT";
    const result = await prepareConnectedClient(client, options.databaseName, options);
    console.log(JSON.stringify({ ok: true, database: options.databaseName,
      collection: COLLECTION_NAME, ...result }));
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
  COLLECTION_NAME, GENERIC_ERROR_MESSAGE, INDEX_KEYS, INDEX_NAME, PARTIAL_FILTER,
  REQUIRED_CONFIRMATION, SafeIndexError, inspectIndexes, parseArguments,
  prepareConnectedClient, prepareIndex, safeDiagnostic,
};
