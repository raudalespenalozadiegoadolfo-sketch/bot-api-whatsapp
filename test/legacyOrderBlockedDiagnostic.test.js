const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const diagnostic = require("../scripts/diagnose-blocked-legacy-orders-production");
const { generateStableId } = require("../services/legacyOrderBackfillService");

function cursor(documents) {
  return { async *[Symbol.asyncIterator]() { yield* documents; } };
}

function clienteModel(customers, calls) {
  return {
    find(filter) {
      calls.push(["find", filter]);
      return {
        select(fields) {
          calls.push(["select", fields]);
          return {
            lean() {
              calls.push(["lean"]);
              return { cursor: () => cursor(customers) };
            },
          };
        },
      };
    },
  };
}

test("emite solo legacyEntryId y blockReason para registros BLOCKED", async () => {
  const blocked = {
    fecha: new Date("2025-01-02T10:00:00.000Z"),
    pedidos: [{ nombre: "dato sensible", precio: 180, cantidad: 1 }],
    numero: "521234567890",
  };
  const ready = {
    fecha: new Date("2025-01-03T10:00:00.000Z"),
    estadoFinal: "entregado",
    pedidos: [{ nombre: "otro dato", precio: 100, cantidad: 1 }],
  };
  const customer = {
    _id: "customer-secret",
    tenantId: "tenant-secret",
    historialPedidos: [blocked, ready],
  };
  const calls = [];
  const output = [];

  await diagnostic.runDiagnostic({
    Cliente: clienteModel([customer], calls),
    logger: line => output.push(line),
  });

  assert.deepEqual(output.map(JSON.parse), [{
    legacyEntryId: generateStableId(customer._id, blocked),
    blockReason: "invalid_status_undefined",
  }]);
  assert.deepEqual(Object.keys(JSON.parse(output[0])), ["legacyEntryId", "blockReason"]);
  assert.doesNotMatch(output[0], /customer-secret|tenant-secret|dato sensible|521234567890/);
  assert.deepEqual(calls, [
    ["find", { historialPedidos: { $exists: true, $ne: [] } }],
    ["select", "_id tenantId branchId historialPedidos"],
    ["lean"],
  ]);
});

test("usa la clasificacion oficial para cada motivo BLOCKED", () => {
  const customer = { _id: "customer", tenantId: "tenant" };
  const entry = { estadoFinal: "entregado", fecha: "invalida", pedidos: [{ nombre: "x", precio: 1 }] };
  assert.deepEqual(diagnostic.blockedDiagnostic(customer, entry), {
    legacyEntryId: generateStableId(customer._id, { ...entry, fecha: null }),
    blockReason: "invalid_date",
  });
});

test("rechaza cualquier argumento, incluido APPLY", () => {
  assert.deepEqual(diagnostic.parseArguments([]), {});
  assert.throws(() => diagnostic.parseArguments(["--apply"]));
  assert.throws(() => diagnostic.parseArguments(["--confirm=MIGRATE_LEGACY_ORDERS"]));
});

test("conecta por MONGO_URI sin indices y no contiene escrituras", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "diagnose-blocked-legacy-orders-production.js"), "utf8");
  assert.match(source, /mongoose\.connect\(env\.MONGO_URI, \{ autoIndex: false \}\)/);
  assert.match(source, /convertLegacyEntry\(customer, entry\)/);
  assert.doesNotMatch(source, /\.(?:create|save|insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite)\s*\(/);
  assert.equal(require("../package.json").scripts["diagnose:legacy-orders:blocked"],
    "node scripts/diagnose-blocked-legacy-orders-production.js");
});

test("el cierre acepta 36 migrados y conserva 3 excepciones sin estadoFinal", () => {
  const closure = fs.readFileSync(path.join(
    __dirname, "..", "docs", "legacy-order-backfill-closure.md"
  ), "utf8");

  assert.match(closure, /`scannedCustomers`: 4/);
  assert.match(closure, /`scannedEntries`: 39/);
  assert.match(closure, /`alreadyMigrated`: 36/);
  assert.match(closure, /`blocked`: 3/);
  assert.match(closure, /`errors`: 0/);
  assert.match(closure, /invalid_status_undefined/);
  assert.match(closure, /no migrables/);
  assert.match(closure, /No volver a ejecutar `APPLY`/);
  assert.match(closure, /No editar ni eliminar los registros legacy/);
});
