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

function parseArguments(args) {
  if (args.some(value => value === "--apply" || value.startsWith("--apply="))) {
    throw new Error("--apply no esta permitido.");
  }
  const destination = args.find(value => value.startsWith("--destination-environment="));
  const database = args.find(value => value.startsWith("--database="));
  const input = args.find(value => value.startsWith("--input="));
  const confirmation = args.find(value => value.startsWith("--confirm="));
  const allowed = new Set([destination, database, input, confirmation].filter(Boolean));
  const unknown = args.filter(value => !allowed.has(value));
  if (unknown.length) throw new Error(`Argumento no permitido: ${unknown[0]}`);
  if (destination?.slice("--destination-environment=".length) !== "staging") {
    throw new Error("--destination-environment=staging es obligatorio.");
  }
  if (database?.slice("--database=".length) !== STAGING_DATABASE) {
    throw new Error(`--database=${STAGING_DATABASE} es obligatorio.`);
  }
  if (confirmation?.slice("--confirm=".length) !== REQUIRED_CONFIRMATION) {
    throw new Error(`--confirm=${REQUIRED_CONFIRMATION} es obligatorio.`);
  }
  const inputDirectory = input?.slice("--input=".length).trim();
  if (!inputDirectory) throw new Error("--input es obligatorio.");
  return { inputDirectory, databaseName: STAGING_DATABASE };
}

function assertStagingDatabase(db) {
  if (!db || db.databaseName !== STAGING_DATABASE) {
    throw new Error(`La conexion debe apuntar exactamente a ${STAGING_DATABASE}.`);
  }
}

function assertFixtureShape(fixture, manifest) {
  if (manifest.version !== FIXTURE_VERSION || fixture.version !== FIXTURE_VERSION) {
    throw new Error("Version de fixture no soportada.");
  }
  for (const [field, expected] of Object.entries(EXPECTED)) {
    if (manifest.counts?.[field] !== expected || fixture.counts?.[field] !== expected) {
      throw new Error(`Conteo de fixture invalido para ${field}.`);
    }
  }
  const names = Object.keys(fixture.collections || {}).sort();
  if (JSON.stringify(names) !== JSON.stringify([...ALLOWED_COLLECTIONS].sort())) {
    throw new Error("El fixture contiene una lista de colecciones no autorizada.");
  }
  for (const name of ALLOWED_COLLECTIONS) {
    if (!Array.isArray(fixture.collections[name])) throw new Error(`Coleccion invalida: ${name}.`);
    for (const document of fixture.collections[name]) {
      if (!(document?._id instanceof ObjectId)) throw new Error(`Documento sin ObjectId valido en ${name}.`);
    }
  }
  if (fixture.collections.orders.length !== 0) {
    throw new Error("El fixture de entrada no puede contener Orders.");
  }
  const actualCounts = countClassifications(fixture.collections.clientes);
  assertExpectedCounts(actualCounts);
  if (JSON.stringify(actualCounts) !== JSON.stringify(fixture.counts)) {
    throw new Error("Los conteos declarados no coinciden con los documentos del fixture.");
  }
}

function loadAndValidateFixture(inputDirectory) {
  const resolved = path.resolve(inputDirectory);
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "manifest.json"), "utf8"));
  if (manifest.fixtureFile !== "legacy-orders.ejson") throw new Error("Nombre de fixture no autorizado.");
  const fixtureText = fs.readFileSync(path.join(resolved, manifest.fixtureFile), "utf8");
  if (fixtureHash(fixtureText) !== manifest.sha256) throw new Error("SHA-256 del fixture no coincide.");
  const fixture = EJSON.parse(fixtureText, { relaxed: false });
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
  const options = parseArguments(args);
  const { fixture } = loadAndValidateFixture(options.inputDirectory);
  const stagingUri = environment.STAGING_MONGO_URI;
  if (!stagingUri) throw new Error("STAGING_MONGO_URI es obligatoria.");
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(stagingUri);
  try {
    await client.connect();
    const db = client.db();
    assertStagingDatabase(db);
    const imported = await importFixture(db, fixture);
    console.log(JSON.stringify({ ok: true, database: STAGING_DATABASE, imported }));
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error("No fue posible importar el fixture; los detalles sensibles fueron omitidos.");
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_COLLECTIONS,
  REQUIRED_CONFIRMATION,
  STAGING_DATABASE,
  assertFixtureShape,
  assertStagingDatabase,
  importFixture,
  loadAndValidateFixture,
  parseArguments,
};
