const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BSON, ObjectId } = require("mongodb");
const { EJSON } = BSON;

const exporter = require("../scripts/export-legacy-orders-staging-fixture");
const importer = require("../scripts/import-legacy-orders-staging-fixture");

const projectRoot = path.join(__dirname, "..");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-fixture-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function validFixtureDirectory(t) {
  const directory = temporaryDirectory(t);
  exporter.writeFixture(directory, exporter.buildFixture(sourceData()));
  return directory;
}

function sourceData() {
  const tenantId = new ObjectId("507f1f77bcf86cd799439001");
  const branchId = new ObjectId("507f1f77bcf86cd799439002");
  const customers = Array.from({ length: 4 }, (_, customerIndex) => ({
    _id: new ObjectId(`507f1f77bcf86cd7994391${String(customerIndex).padStart(2, "0")}`),
    tenantId,
    branchId,
    historialPedidos: [],
  }));

  for (let index = 0; index < 39; index += 1) {
    const entry = {
      _id: new ObjectId(`607f1f77bcf86cd7994391${String(index).padStart(2, "0")}`),
      fecha: new Date(2025, 0, index + 1),
      pedidos: [{ nombre: `Nombre real ${index}`, precio: 100 + index, cantidad: 1 + (index % 2) }],
      total: (100 + index) * (1 + (index % 2)),
      nombre: `Persona ${index}`,
      numero: `telefono-${index}`,
      direccion: { latitud: 19.4, longitud: -99.1 },
    };
    if (index >= 3) entry.estadoFinal = index % 5 === 0 ? "cancelado" : "entregado";
    customers[index % customers.length].historialPedidos.push(entry);
  }

  return {
    customers,
    tenants: [{ _id: tenantId, timezone: "America/Mexico_City", currency: "MXN", businessType: "restaurant" }],
    branches: [{ _id: branchId, tenantId, active: true }],
  };
}

test("exportador exige produccion, rechaza apply y no acepta argumentos desconocidos", () => {
  assert.throws(() => exporter.parseArguments(["--apply"]), /no esta permitido/);
  assert.throws(() => exporter.parseArguments(["--source-environment=staging", "--output=x"]), /production/);
  assert.throws(() => exporter.parseArguments(["--source-environment=production", "--output=x", "--extra"]), /no permitido/);
  assert.deepEqual(
    exporter.parseArguments(["--source-environment=production", "--output=fixture"]),
    { outputDirectory: "fixture" }
  );
});

test("sanitizacion conserva 39 entradas, 36 migrables y 3 bloqueadas sin estadoFinal", () => {
  const fixture = exporter.buildFixture(sourceData());
  assert.deepEqual(fixture.counts, exporter.EXPECTED);

  const entries = fixture.collections.clientes.flatMap(customer => customer.historialPedidos);
  const missingStatus = entries.filter(entry => !Object.prototype.hasOwnProperty.call(entry, "estadoFinal"));
  assert.equal(missingStatus.length, 3);
  assert.equal(entries.filter(entry => entry.estadoFinal === "entregado").length +
    entries.filter(entry => entry.estadoFinal === "cancelado").length, 36);

  const serialized = exporter.serializeFixture(fixture);
  const restored = EJSON.parse(serialized, { relaxed: false });
  const restoredEntries = restored.collections.clientes.flatMap(customer => customer.historialPedidos);
  assert.equal(restoredEntries.filter(entry => !Object.prototype.hasOwnProperty.call(entry, "estadoFinal")).length, 3);
  assert.doesNotMatch(serialized, /Nombre real|Persona|telefono|latitud|longitud/);
});

test("IDs y nombres sanitizados son deterministas", () => {
  const first = exporter.serializeFixture(exporter.buildFixture(sourceData()));
  const second = exporter.serializeFixture(exporter.buildFixture(sourceData()));
  assert.equal(first, second);
  assert.equal(exporter.fixtureHash(first), exporter.fixtureHash(second));
});

test("importador exige staging, base exacta y confirmacion propia", () => {
  const valid = [
    "--destination-environment=staging",
    "--database=marisco_alegre_staging",
    "--input=fixture",
    "--confirm=IMPORT_STAGING_FIXTURE",
  ];
  assert.throws(
    () => importer.parseArguments(["--apply", ...valid]),
    error => error.code === importer.ERROR_CODES.INVALID_ARGUMENT
  );
  assert.throws(
    () => importer.parseArguments(valid.map(value =>
      value.startsWith("--database=") ? "--database=produccion" : value
    )),
    error => error.code === importer.ERROR_CODES.WRONG_DATABASE
  );
  assert.throws(
    () => importer.parseArguments(valid.filter(value => !value.startsWith("--confirm="))),
    error => error.code === importer.ERROR_CODES.INVALID_ARGUMENT
  );
  assert.deepEqual(importer.parseArguments(valid), {
    inputDirectory: "fixture",
    databaseName: "marisco_alegre_staging",
  });
  assert.throws(
    () => importer.assertStagingDatabase({ databaseName: "otra_base" }),
    error => error.code === importer.ERROR_CODES.WRONG_DATABASE &&
      error.stage === importer.ERROR_STAGES.DATABASE_VERIFICATION
  );
});

test("diagnostico seguro clasifica codigos y etapas sin filtrar detalles", () => {
  const cases = [
    [{ code: 18, message: "mongodb://usuario:secreto@host" }, importer.ERROR_STAGES.CONNECTION, "AUTH_FAILED"],
    [{ code: 13, message: "documento privado" }, importer.ERROR_STAGES.WRITE, "PERMISSION_DENIED"],
    [{ name: "MongoServerSelectionError", message: "hostname privado" }, importer.ERROR_STAGES.CONNECTION, "NETWORK_ERROR"],
    [{ message: "documento privado" }, importer.ERROR_STAGES.WRITE, "WRITE_FAILED"],
    [{ message: "secreto interno" }, importer.ERROR_STAGES.CONNECTION, "UNKNOWN_ERROR"],
  ];

  for (const [error, stage, expectedCode] of cases) {
    const diagnostic = importer.safeDiagnostic(error, stage);
    assert.deepEqual(diagnostic, {
      ok: false,
      code: expectedCode,
      stage,
      message: importer.GENERIC_ERROR_MESSAGE,
    });
    const serialized = JSON.stringify(diagnostic);
    assert.doesNotMatch(serialized, /usuario|secreto|hostname|documento|mongodb/);
  }
});

test("diagnostico seguro conserva codigos locales especificos", () => {
  for (const [code, stage] of [
    ["WRONG_DATABASE", importer.ERROR_STAGES.DATABASE_VERIFICATION],
    ["HASH_MISMATCH", importer.ERROR_STAGES.LOCAL_VALIDATION],
    ["INVALID_FIXTURE", importer.ERROR_STAGES.LOCAL_VALIDATION],
  ]) {
    const diagnostic = importer.safeDiagnostic(new importer.SafeImportError(code, stage));
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.stage, stage);
    assert.equal(Object.hasOwn(diagnostic, "stack"), false);
  }
});

test("subcodigos distinguen archivos ausentes, parse y hash", t => {
  const missingManifest = temporaryDirectory(t);
  assert.throws(
    () => importer.loadAndValidateFixture(missingManifest),
    error => error.subcode === "MANIFEST_MISSING"
  );

  const badManifest = validFixtureDirectory(t);
  fs.writeFileSync(path.join(badManifest, "manifest.json"), "{invalido", "utf8");
  assert.throws(
    () => importer.loadAndValidateFixture(badManifest),
    error => error.subcode === "MANIFEST_PARSE_FAILED"
  );

  const missingFixture = validFixtureDirectory(t);
  fs.rmSync(path.join(missingFixture, "legacy-orders.ejson"));
  assert.throws(
    () => importer.loadAndValidateFixture(missingFixture),
    error => error.subcode === "FIXTURE_MISSING"
  );

  const badHash = validFixtureDirectory(t);
  fs.appendFileSync(path.join(badHash, "legacy-orders.ejson"), " ", "utf8");
  assert.throws(
    () => importer.loadAndValidateFixture(badHash),
    error => error.code === "HASH_MISMATCH" && error.subcode === "HASH_MISMATCH"
  );

  const badFixture = validFixtureDirectory(t);
  const invalidText = "{ejson-invalido";
  fs.writeFileSync(path.join(badFixture, "legacy-orders.ejson"), invalidText, "utf8");
  const manifestPath = path.join(badFixture, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.sha256 = exporter.fixtureHash(invalidText);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  assert.throws(
    () => importer.loadAndValidateFixture(badFixture),
    error => error.subcode === "FIXTURE_PARSE_FAILED"
  );
});

test("fixture Extended JSON valido supera toda la validacion local", t => {
  const directory = validFixtureDirectory(t);
  const loaded = importer.loadAndValidateFixture(directory);
  assert.equal(loaded.fixture.version, exporter.FIXTURE_VERSION);
  assert.equal(importer.numericCount(loaded.fixture.counts.entries), 39);
});

test("subcodigos distinguen estructura, version, IDs, Orders y conteos", () => {
  const base = exporter.buildFixture(sourceData());
  const manifest = { version: exporter.FIXTURE_VERSION, counts: { ...exporter.EXPECTED } };
  const clone = value => EJSON.parse(EJSON.stringify(value, { relaxed: false }), { relaxed: false });

  const wrongVersion = clone(base);
  wrongVersion.version = "otra-version";
  assert.throws(() => importer.assertFixtureShape(wrongVersion, manifest),
    error => error.subcode === "VERSION_MISMATCH");

  const wrongCounts = clone(base);
  const wrongCountsManifest = { ...manifest, counts: { ...manifest.counts, entries: 40 } };
  assert.throws(() => importer.assertFixtureShape(wrongCounts, wrongCountsManifest),
    error => error.subcode === "COUNTS_MISMATCH");

  const invalidStructure = clone(base);
  delete invalidStructure.collections.branches;
  assert.throws(() => importer.assertFixtureShape(invalidStructure, manifest),
    error => error.subcode === "INVALID_STRUCTURE");

  const invalidId = clone(base);
  invalidId.collections.tenants[0]._id = "no-object-id";
  assert.throws(() => importer.assertFixtureShape(invalidId, manifest),
    error => error.subcode === "INVALID_OBJECT_ID");

  const orders = clone(base);
  orders.collections.orders.push({ _id: new ObjectId() });
  assert.throws(() => importer.assertFixtureShape(orders, manifest),
    error => error.subcode === "ORDERS_NOT_EMPTY");

  const legacyCounts = clone(base);
  legacyCounts.collections.clientes[0].historialPedidos.pop();
  assert.throws(() => importer.assertFixtureShape(legacyCounts, manifest),
    error => error.subcode === "LEGACY_COUNTS_MISMATCH");
});

test("salida de subcodigo no incluye contenido ni errores internos", () => {
  const error = new importer.SafeImportError(
    importer.ERROR_CODES.INVALID_FIXTURE,
    importer.ERROR_STAGES.LOCAL_VALIDATION,
    importer.FIXTURE_SUBCODES.INVALID_STRUCTURE
  );
  error.stack = "mongodb://usuario:password@hostname/documento";
  const diagnostic = importer.safeDiagnostic(error);
  assert.deepEqual(diagnostic, {
    ok: false,
    code: "INVALID_FIXTURE",
    stage: "LOCAL_VALIDATION",
    message: importer.GENERIC_ERROR_MESSAGE,
    subcode: "INVALID_STRUCTURE",
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /usuario|password|hostname|documento|mongodb/);
});

test("importacion es idempotente con mocks y no borra documentos ajenos", async () => {
  const fixture = exporter.buildFixture(sourceData());
  const stored = new Map([["ajeno", { _id: "ajeno", value: true }]]);
  const calls = [];
  const db = {
    databaseName: "marisco_alegre_staging",
    collection(name) {
      return {
        async replaceOne(filter, document, options) {
          calls.push({ name, filter, options });
          stored.set(`${name}:${String(filter._id)}`, EJSON.stringify(document, { relaxed: false }));
          return { acknowledged: true };
        },
      };
    },
  };

  await importer.importFixture(db, fixture);
  const afterFirst = new Map(stored);
  await importer.importFixture(db, fixture);
  assert.deepEqual(stored, afterFirst);
  assert.deepEqual(stored.get("ajeno"), { _id: "ajeno", value: true });
  assert.ok(calls.every(call => call.options.upsert === true && Object.keys(call.filter).length === 1));
});

test("scripts separan credenciales y no contienen operaciones MongoDB prohibidas", () => {
  const exportSource = fs.readFileSync(path.join(projectRoot, "scripts", "export-legacy-orders-staging-fixture.js"), "utf8");
  const importSource = fs.readFileSync(path.join(projectRoot, "scripts", "import-legacy-orders-staging-fixture.js"), "utf8");
  assert.match(exportSource, /environment\.SOURCE_MONGO_URI/);
  assert.doesNotMatch(exportSource, /environment\.(?:MONGO_URI|STAGING_MONGO_URI)/);
  assert.doesNotMatch(exportSource, /\.collection\([^)]*\)\.(?:insert|replace|update|delete|bulkWrite|drop)/);
  assert.match(importSource, /environment\.STAGING_MONGO_URI/);
  assert.doesNotMatch(importSource, /environment\.(?:MONGO_URI|SOURCE_MONGO_URI)/);
  for (const source of [exportSource, importSource]) {
    assert.doesNotMatch(source, /syncIndexes|dropDatabase|dropCollection|deleteMany/);
  }
});
