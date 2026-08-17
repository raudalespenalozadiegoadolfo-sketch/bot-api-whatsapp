#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { BSON, ObjectId } = require("mongodb");
const { EJSON } = BSON;
const {
  EXPECTED,
  FIXTURE_VERSION,
  assertExpectedCounts,
  countClassifications,
  fixtureHash,
} = require("./export-legacy-orders-staging-fixture");

const STAGING_DATABASE = "marisco_alegre_staging";
const REQUIRED_CONFIRMATION = "IMPORT_STAGING_FIXTURE";
const ALLOWED_COLLECTIONS = Object.freeze(["tenants", "branches", "clientes", "orders"]);
const GENERIC_ERROR_MESSAGE = "La importacion de staging fallo; los detalles internos fueron omitidos.";
const ERROR_CODES = Object.freeze({
  AUTH_FAILED: "AUTH_FAILED",
  WRONG_DATABASE: "WRONG_DATABASE",
  HASH_MISMATCH: "HASH_MISMATCH",
  INVALID_FIXTURE: "INVALID_FIXTURE",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NETWORK_ERROR: "NETWORK_ERROR",
  WRITE_FAILED: "WRITE_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
});
const ERROR_STAGES = Object.freeze({
  LOCAL_VALIDATION: "LOCAL_VALIDATION",
  CONNECTION: "CONNECTION",
  DATABASE_VERIFICATION: "DATABASE_VERIFICATION",
  WRITE: "WRITE",
});
const FIXTURE_SUBCODES = Object.freeze({
  MANIFEST_MISSING: "MANIFEST_MISSING",
  FIXTURE_MISSING: "FIXTURE_MISSING",
  MANIFEST_PARSE_FAILED: "MANIFEST_PARSE_FAILED",
  FIXTURE_PARSE_FAILED: "FIXTURE_PARSE_FAILED",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  HASH_MISMATCH: "HASH_MISMATCH",
  COUNTS_MISMATCH: "COUNTS_MISMATCH",
  ORDERS_NOT_EMPTY: "ORDERS_NOT_EMPTY",
  INVALID_OBJECT_ID: "INVALID_OBJECT_ID",
  INVALID_STRUCTURE: "INVALID_STRUCTURE",
  LEGACY_COUNTS_MISMATCH: "LEGACY_COUNTS_MISMATCH",
});

class SafeImportError extends Error {
  constructor(code, stage, subcode = null) {
    super(GENERIC_ERROR_MESSAGE);
    this.name = "SafeImportError";
    this.code = code;
    this.stage = stage;
    this.subcode = subcode;
  }
}

function safeError(code, stage, subcode = null) {
  return new SafeImportError(code, stage, subcode);
}

function classifyImportError(error, stage = ERROR_STAGES.LOCAL_VALIDATION) {
  if (error instanceof SafeImportError) return error;
  const numericCode = Number(error?.code);
  const codeName = String(error?.codeName || "");
  const errorName = String(error?.name || "");
  if (numericCode === 18 || codeName === "AuthenticationFailed") {
    return safeError(ERROR_CODES.AUTH_FAILED, stage);
  }
  if (numericCode === 13 || codeName === "Unauthorized") {
    return safeError(ERROR_CODES.PERMISSION_DENIED, stage);
  }
  if (["MongoNetworkError", "MongoServerSelectionError", "MongoTopologyClosedError"].includes(errorName) ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(String(error?.code || ""))) {
    return safeError(ERROR_CODES.NETWORK_ERROR, stage);
  }
  if (stage === ERROR_STAGES.WRITE) return safeError(ERROR_CODES.WRITE_FAILED, stage);
  return safeError(ERROR_CODES.UNKNOWN_ERROR, stage);
}

function safeDiagnostic(error, stage) {
  const classified = classifyImportError(error, stage);
  const diagnostic = {
    ok: false,
    code: classified.code,
    stage: classified.stage,
    message: GENERIC_ERROR_MESSAGE,
  };
  if (classified.subcode) diagnostic.subcode = classified.subcode;
  return diagnostic;
}

function parseArguments(args) {
  if (args.some(value => value === "--apply" || value.startsWith("--apply="))) {
    throw safeError(ERROR_CODES.INVALID_ARGUMENT, ERROR_STAGES.LOCAL_VALIDATION);
  }
  const destination = args.find(value => value.startsWith("--destination-environment="));
  const database = args.find(value => value.startsWith("--database="));
  const input = args.find(value => value.startsWith("--input="));
  const confirmation = args.find(value => value.startsWith("--confirm="));
  const allowed = new Set([destination, database, input, confirmation].filter(Boolean));
  const unknown = args.filter(value => !allowed.has(value));
  if (unknown.length) throw safeError(ERROR_CODES.INVALID_ARGUMENT, ERROR_STAGES.LOCAL_VALIDATION);
  if (destination?.slice("--destination-environment=".length) !== "staging") {
    throw safeError(ERROR_CODES.INVALID_ARGUMENT, ERROR_STAGES.LOCAL_VALIDATION);
  }
  if (database?.slice("--database=".length) !== STAGING_DATABASE) {
    throw safeError(ERROR_CODES.WRONG_DATABASE, ERROR_STAGES.LOCAL_VALIDATION);
  }
  if (confirmation?.slice("--confirm=".length) !== REQUIRED_CONFIRMATION) {
    throw safeError(ERROR_CODES.INVALID_ARGUMENT, ERROR_STAGES.LOCAL_VALIDATION);
  }
  const inputDirectory = input?.slice("--input=".length).trim();
  if (!inputDirectory) throw safeError(ERROR_CODES.INVALID_ARGUMENT, ERROR_STAGES.LOCAL_VALIDATION);
  return { inputDirectory, databaseName: STAGING_DATABASE };
}

function assertStagingDatabase(db) {
  if (!db || db.databaseName !== STAGING_DATABASE) {
    throw safeError(ERROR_CODES.WRONG_DATABASE, ERROR_STAGES.DATABASE_VERIFICATION);
  }
}

function numericCount(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function assertFixtureShape(fixture, manifest) {
  if (manifest.version !== FIXTURE_VERSION || fixture.version !== FIXTURE_VERSION) {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.VERSION_MISMATCH);
  }
  for (const [field, expected] of Object.entries(EXPECTED)) {
    if (numericCount(manifest.counts?.[field]) !== expected ||
        numericCount(fixture.counts?.[field]) !== expected) {
      throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.COUNTS_MISMATCH);
    }
  }
  const names = Object.keys(fixture.collections || {}).sort();
  if (JSON.stringify(names) !== JSON.stringify([...ALLOWED_COLLECTIONS].sort())) {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.INVALID_STRUCTURE);
  }
  for (const name of ALLOWED_COLLECTIONS) {
    if (!Array.isArray(fixture.collections[name])) {
      throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.INVALID_STRUCTURE);
    }
    for (const document of fixture.collections[name]) {
      if (!(document?._id instanceof ObjectId)) {
        throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.INVALID_OBJECT_ID);
      }
    }
  }
  if (fixture.collections.orders.length !== 0) {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.ORDERS_NOT_EMPTY);
  }
  const actualCounts = countClassifications(fixture.collections.clientes);
  try {
    assertExpectedCounts(actualCounts);
  } catch {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.LEGACY_COUNTS_MISMATCH);
  }
  for (const field of Object.keys(EXPECTED)) {
    if (actualCounts[field] !== numericCount(fixture.counts[field])) {
      throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.COUNTS_MISMATCH);
    }
  }
}

function loadAndValidateFixture(inputDirectory) {
  const resolved = path.resolve(inputDirectory);
  const manifestPath = path.join(resolved, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.MANIFEST_MISSING);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.MANIFEST_PARSE_FAILED);
  }
  if (manifest.fixtureFile !== "legacy-orders.ejson") {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.INVALID_STRUCTURE);
  }
  const fixturePath = path.join(resolved, manifest.fixtureFile);
  if (!fs.existsSync(fixturePath)) {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.FIXTURE_MISSING);
  }
  let fixtureText;
  try {
    fixtureText = fs.readFileSync(fixturePath, "utf8");
  } catch {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.FIXTURE_PARSE_FAILED);
  }
  if (fixtureHash(fixtureText) !== manifest.sha256) {
    throw safeError(ERROR_CODES.HASH_MISMATCH, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.HASH_MISMATCH);
  }
  let fixture;
  try {
    fixture = EJSON.parse(fixtureText, { relaxed: false });
  } catch {
    throw safeError(ERROR_CODES.INVALID_FIXTURE, ERROR_STAGES.LOCAL_VALIDATION, FIXTURE_SUBCODES.FIXTURE_PARSE_FAILED);
  }
  assertFixtureShape(fixture, manifest);
  return { fixture, manifest };
}

async function importFixture(db, fixture) {
  assertStagingDatabase(db);
  const summary = {};
  for (const collectionName of ALLOWED_COLLECTIONS) {
    const documents = fixture.collections[collectionName];
    let replaced = 0;
    for (const document of documents) {
      await db.collection(collectionName).replaceOne(
        { _id: document._id },
        document,
        { upsert: true }
      );
      replaced += 1;
    }
    summary[collectionName] = replaced;
  }
  return summary;
}

async function main(args = process.argv.slice(2), environment = process.env) {
  let stage = ERROR_STAGES.LOCAL_VALIDATION;
  let client = null;
  try {
    const options = parseArguments(args);
    const { fixture } = loadAndValidateFixture(options.inputDirectory);
    const stagingUri = environment.STAGING_MONGO_URI;
    if (!stagingUri) throw safeError(ERROR_CODES.INVALID_ARGUMENT, stage);
    stage = ERROR_STAGES.CONNECTION;
    const { MongoClient } = require("mongodb");
    client = new MongoClient(stagingUri);
    await client.connect();
    const db = client.db();
    stage = ERROR_STAGES.DATABASE_VERIFICATION;
    assertStagingDatabase(db);
    stage = ERROR_STAGES.WRITE;
    const imported = await importFixture(db, fixture);
    console.log(JSON.stringify({ ok: true, database: STAGING_DATABASE, imported }));
  } catch (error) {
    throw classifyImportError(error, stage);
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
  ALLOWED_COLLECTIONS,
  ERROR_CODES,
  ERROR_STAGES,
  FIXTURE_SUBCODES,
  GENERIC_ERROR_MESSAGE,
  REQUIRED_CONFIRMATION,
  SafeImportError,
  STAGING_DATABASE,
  assertFixtureShape,
  assertStagingDatabase,
  classifyImportError,
  importFixture,
  loadAndValidateFixture,
  numericCount,
  parseArguments,
  safeDiagnostic,
};
