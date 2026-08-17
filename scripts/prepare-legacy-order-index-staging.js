#!/usr/bin/env node

const { MongoClient } = require("mongodb");

const DATABASE_NAME = "marisco_alegre_staging";
const COLLECTION_NAME = "orders";
const INDEX_NAME = "tenantId_1_legacySource.type_1_legacySource.customerId_1_legacySource.legacyEntryId_1";
const REQUIRED_CONFIRMATION = "CREATE_LEGACY_ORDER_INDEX_IN_STAGING";
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

class SafeIndexError extends Error {
  constructor(code, stage) {
    super("No fue posible preparar el indice; los detalles internos fueron omitidos.");
    this.name = "SafeIndexError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage) {
  throw new SafeIndexError(code, stage);
}

function parseArguments(args) {
  if (args.some(arg => arg === "--apply" || arg.startsWith("--apply="))) {
    fail("INVALID_ARGUMENT", "LOCAL_VALIDATION");
  }
  const destinationArgs = args.filter(arg => arg.startsWith("--destination-environment="));
  const databaseArgs = args.filter(arg => arg.startsWith("--database="));
  const confirmationArgs = args.filter(arg => arg.startsWith("--confirm="));
  const known = args.every(arg => arg === "--create" || arg.startsWith("--destination-environment=") ||
    arg.startsWith("--database=") || arg.startsWith("--confirm="));
  if (!known || destinationArgs.length !== 1 || databaseArgs.length !== 1 || confirmationArgs.length > 1) {
    fail("INVALID_ARGUMENT", "LOCAL_VALIDATION");
  }
  if (destinationArgs[0] !== "--destination-environment=staging") fail("INVALID_ARGUMENT", "LOCAL_VALIDATION");
  if (databaseArgs[0] !== `--database=${DATABASE_NAME}`) fail("WRONG_DATABASE", "LOCAL_VALIDATION");
  const create = args.includes("--create");
  const confirmation = args.includes(`--confirm=${REQUIRED_CONFIRMATION}`);
  if (create !== confirmation) fail("CONFIRMATION_REQUIRED", "LOCAL_VALIDATION");
  return { create };
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCompatible(index) {
  return sameDocument(index.key, INDEX_KEYS) && index.unique === true &&
    sameDocument(index.partialFilterExpression, PARTIAL_FILTER);
}

function inspectIndexes(indexes) {
  const sameName = indexes.find(index => index.name === INDEX_NAME);
  const samePurpose = indexes.find(index => sameDocument(index.key, INDEX_KEYS));
  const candidates = indexes.filter(index => index.name === INDEX_NAME || sameDocument(index.key, INDEX_KEYS));
  if (!candidates.length) return { status: "MISSING" };
  if (candidates.some(index => !isCompatible(index))) fail("INCOMPATIBLE_INDEX", "INDEX_AUDIT");
  return { status: "READY", name: (sameName || samePurpose).name };
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
  if (db?.databaseName !== DATABASE_NAME) fail("WRONG_DATABASE", "DATABASE_VERIFICATION");
  const collection = db.collection(COLLECTION_NAME);
  const before = inspectIndexes(await listIndexes(collection));
  if (before.status === "READY" || !create) return { mode: create ? "CREATE" : "DRY_RUN", ...before };
  await collection.createIndex(INDEX_KEYS, {
    name: INDEX_NAME,
    unique: true,
    partialFilterExpression: PARTIAL_FILTER,
  });
  const after = inspectIndexes(await listIndexes(collection));
  if (after.status !== "READY") fail("VERIFICATION_FAILED", "POST_CREATE_VERIFICATION");
  return { mode: "CREATE", status: "CREATED", name: after.name };
}

function classifyError(error, stage) {
  if (error instanceof SafeIndexError) return error;
  if (error?.code === 18 || error?.codeName === "AuthenticationFailed") return new SafeIndexError("AUTH_FAILED", stage);
  if (error?.code === 13 || error?.codeName === "Unauthorized") return new SafeIndexError("PERMISSION_DENIED", stage);
  if (["MongoNetworkError", "MongoServerSelectionError"].includes(error?.name)) return new SafeIndexError("NETWORK_ERROR", stage);
  if (stage === "INDEX_CREATE") return new SafeIndexError("CREATE_FAILED", stage);
  return new SafeIndexError("UNKNOWN_ERROR", stage);
}

async function main(args = process.argv.slice(2), environment = process.env) {
  let client;
  let stage = "LOCAL_VALIDATION";
  try {
    const options = parseArguments(args);
    if (!environment.STAGING_MONGO_URI) fail("MISSING_STAGING_URI", stage);
    stage = "CONNECTION";
    client = new MongoClient(environment.STAGING_MONGO_URI);
    await client.connect();
    stage = "DATABASE_VERIFICATION";
    const db = client.db();
    if (db.databaseName !== DATABASE_NAME) fail("WRONG_DATABASE", stage);
    stage = options.create ? "INDEX_CREATE" : "INDEX_AUDIT";
    const result = await prepareIndex(db, options);
    console.log(JSON.stringify({ ok: true, database: DATABASE_NAME, collection: COLLECTION_NAME, ...result }));
  } catch (error) {
    throw classifyError(error, stage);
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    const safe = classifyError(error, "UNKNOWN");
    console.error(JSON.stringify({ ok: false, code: safe.code, stage: safe.stage,
      message: "No fue posible preparar el indice; los detalles internos fueron omitidos." }));
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAME, INDEX_KEYS, INDEX_NAME, PARTIAL_FILTER, REQUIRED_CONFIRMATION,
  SafeIndexError, classifyError, inspectIndexes, isCompatible, parseArguments, prepareIndex,
};
