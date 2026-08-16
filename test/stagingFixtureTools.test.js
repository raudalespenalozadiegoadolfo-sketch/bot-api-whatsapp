const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BSON, ObjectId } = require("mongodb");
const { EJSON } = BSON;

const exporter = require("../scripts/export-legacy-orders-staging-fixture");
const importer = require("../scripts/import-legacy-orders-staging-fixture");

const projectRoot = path.join(__dirname, "..");

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
  assert.throws(() => importer.parseArguments(["--apply", ...valid]), /no esta permitido/);
  assert.throws(() => importer.parseArguments(valid.map(value =>
    value.startsWith("--database=") ? "--database=produccion" : value
  )), /marisco_alegre_staging/);
  assert.throws(() => importer.parseArguments(valid.filter(value => !value.startsWith("--confirm="))), /IMPORT_STAGING_FIXTURE/);
  assert.deepEqual(importer.parseArguments(valid), {
    inputDirectory: "fixture",
    databaseName: "marisco_alegre_staging",
  });
  assert.throws(() => importer.assertStagingDatabase({ databaseName: "otra_base" }), /exactamente/);
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
