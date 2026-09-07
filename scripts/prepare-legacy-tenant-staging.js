#!/usr/bin/env node

const { MongoClient } = require("mongodb");

const DATABASE_NAME = "marisco_alegre_staging";
const TENANT_SLUG = "marisco-alegre";
const LEGACY_TENANT = Object.freeze({
  name: "Marisco Alegre",
  slug: TENANT_SLUG,
  storefrontKey: TENANT_SLUG,
  status: "active",
  timezone: "America/Mexico_City",
  currency: "MXN",
  businessType: "restaurant",
});

const ERROR_CODES = Object.freeze({
  MONGO_URI_MISSING: "MONGO_URI_MISSING",
  WRONG_DATABASE: "WRONG_DATABASE",
  DUPLICATE_LEGACY_TENANT: "DUPLICATE_LEGACY_TENANT",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  APPLY_FAILED: "APPLY_FAILED",
});

function parseArguments(args = []) {
  const apply = args.includes("--apply");
  const unknown = args.filter(argument => argument !== "--apply");
  if (unknown.length) throw new Error("INVALID_ARGUMENT");
  return { apply };
}

function output({ mode, status, existingMatches }) {
  return {
    mode,
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    status,
    existingMatches,
  };
}

async function prepareLegacyTenant({ db, apply = false }) {
  if (!db || db.databaseName !== DATABASE_NAME) {
    throw new Error(ERROR_CODES.WRONG_DATABASE);
  }

  const tenants = db.collection("tenants");
  const existingMatches = await tenants.countDocuments({ slug: TENANT_SLUG });
  if (existingMatches > 1) {
    throw new Error(ERROR_CODES.DUPLICATE_LEGACY_TENANT);
  }
  if (existingMatches === 1) {
    return output({
      mode: apply ? "APPLY" : "DRY_RUN",
      status: "ALREADY_EXISTS",
      existingMatches,
    });
  }
  if (!apply) {
    return output({
      mode: "DRY_RUN",
      status: "WOULD_CREATE",
      existingMatches,
    });
  }

  try {
    await tenants.insertOne({ ...LEGACY_TENANT });
  } catch {
    throw new Error(ERROR_CODES.APPLY_FAILED);
  }

  return output({ mode: "APPLY", status: "CREATED", existingMatches });
}

async function run({ uri, apply = false, MongoClientClass = MongoClient }) {
  if (!uri) throw new Error(ERROR_CODES.MONGO_URI_MISSING);

  let client;
  try {
    client = new MongoClientClass(uri);
    await client.connect();
    const db = client.db(DATABASE_NAME);
    if (db.databaseName !== DATABASE_NAME) {
      throw new Error(ERROR_CODES.WRONG_DATABASE);
    }
    return await prepareLegacyTenant({ db, apply });
  } catch (error) {
    if (Object.values(ERROR_CODES).includes(error.message)) throw error;
    if (error.message === "MONGO_URI_MISSING") throw error;
    if (error.name === "MongoServerSelectionError" || error.name === "MongoNetworkError") {
      throw new Error(ERROR_CODES.CONNECTION_FAILED);
    }
    throw new Error(apply ? ERROR_CODES.APPLY_FAILED : ERROR_CODES.CONNECTION_FAILED);
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

async function main(args = process.argv.slice(2), environment = process.env) {
  const { apply } = parseArguments(args);
  return run({ uri: environment.MONGO_URI, apply });
}

if (require.main === module) {
  require("dotenv").config();
  main()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      const code = Object.values(ERROR_CODES).includes(error.message)
        ? error.message
        : "CONNECTION_FAILED";
      console.error(JSON.stringify({ ok: false, code }));
      process.exitCode = 1;
    });
}

module.exports = {
  DATABASE_NAME,
  ERROR_CODES,
  LEGACY_TENANT,
  TENANT_SLUG,
  main,
  parseArguments,
  prepareLegacyTenant,
  run,
};