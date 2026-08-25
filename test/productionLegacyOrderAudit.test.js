const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const audit = require("../scripts/audit-legacy-orders-production");

const args = ["--source-environment=production", "--database=production_db"];

function asyncCursor(documents) {
  return { async *[Symbol.asyncIterator]() { yield* documents; } };
}

function database({ customers = [], ordersExist = true, indexes = [], legacyOrders = 0 } = {}) {
  const calls = [];
  return {
    calls,
    databaseName: "production_db",
    listCollections(filter) {
      calls.push(["listCollections", filter.name]);
      const exists = filter.name === "clientes" || (filter.name === "orders" && ordersExist);
      return { toArray: async () => exists ? [{ name: filter.name }] : [] };
    },
    collection(name) {
      return {
        find(filter, options) {
          calls.push(["find", name, filter, options]);
          return asyncCursor(customers);
        },
        async countDocuments(filter) {
          calls.push(["countDocuments", name, filter]);
          return legacyOrders;
        },
        listIndexes() {
          calls.push(["listIndexes", name]);
          return { toArray: async () => indexes };
        },
      };
    },
  };
}

function compatibleIndex() {
  return { name: audit.INDEX_NAME, key: { ...audit.INDEX_KEYS }, unique: true,
    partialFilterExpression: JSON.parse(JSON.stringify(audit.PARTIAL_FILTER)) };
}

test("argumentos exigen produccion y base exacta; rechazan escritura y desconocidos", () => {
  assert.deepEqual(audit.parseArguments(args), { databaseName: "production_db" });
  for (const forbidden of ["--apply", "--create", "--delete"]) {
    assert.throws(() => audit.parseArguments([...args, forbidden]), error => error.code === "FORBIDDEN_ARGUMENT");
  }
  assert.throws(() => audit.parseArguments([...args, "--extra"]), error => error.code === "INVALID_ARGUMENT");
  assert.throws(() => audit.parseArguments(["--source-environment=staging", "--database=production_db"]),
    error => error.code === "WRONG_ENVIRONMENT");
});

test("clasifica el indice exacto como READY y variantes como MISSING o INCOMPATIBLE", () => {
  assert.equal(audit.legacyIndexStatus([compatibleIndex()]), "READY");
  assert.equal(audit.legacyIndexStatus([]), "MISSING");
  assert.equal(audit.legacyIndexStatus([{ ...compatibleIndex(), unique: false }]), "INCOMPATIBLE");
  assert.equal(audit.legacyIndexStatus([{ name: audit.INDEX_NAME, key: { tenantId: 1 } }]), "INCOMPATIBLE");
});

test("auditoria usa la clasificacion oficial y devuelve solo el resumen permitido", async () => {
  const customer = { _id: "customer", tenantId: "tenant", branchId: null, historialPedidos: [
    { fecha: new Date("2025-01-01"), estadoFinal: "entregado", pedidos: [{ nombre: "x", precio: 10, cantidad: 1 }], total: 10 },
    { fecha: new Date("2025-01-02"), pedidos: [{ nombre: "y", precio: 20, cantidad: 1 }], total: 20 },
  ] };
  const db = database({ customers: [customer], indexes: [compatibleIndex()], legacyOrders: 7 });
  assert.deepEqual(await audit.auditDatabase(db, "production_db"), {
    database: "production_db", clientesConHistorial: 1, scannedEntries: 2,
    legacyOrdersActuales: 7, ordersCollectionExists: true, legacyIndexStatus: "READY",
    blockedCount: 1, migratableCount: 1,
  });
  assert.deepEqual(db.calls.map(call => call[0]), ["listCollections", "listCollections", "find", "countDocuments", "listIndexes"]);
});

test("coleccion orders ausente produce conteos cero e indice MISSING", async () => {
  const result = await audit.auditDatabase(database({ ordersExist: false }), "production_db");
  assert.equal(result.ordersCollectionExists, false);
  assert.equal(result.legacyOrdersActuales, 0);
  assert.equal(result.legacyIndexStatus, "MISSING");
});

test("aborta si la base conectada no coincide", async () => {
  await assert.rejects(() => audit.auditDatabase({ databaseName: "otra" }, "production_db"),
    error => error.code === "WRONG_DATABASE");
});

test("selecciona explicitamente --database aunque la URI tenga otra base predeterminada", async () => {
  const target = database({ ordersExist: false });
  const selected = [];
  const client = {
    defaultDatabaseName: "otra_base_en_uri",
    db(name) {
      selected.push(name);
      return target;
    },
  };
  const result = await audit.auditConnectedClient(client, "production_db");
  assert.deepEqual(selected, ["production_db"]);
  assert.equal(result.database, "production_db");
});

test("errores exponen solo codigo, etapa y mensaje generico", () => {
  const diagnostic = audit.safeDiagnostic({ code: 18, message: "secreto", stack: "datos" }, "CONNECTION");
  assert.deepEqual(diagnostic, { ok: false, code: "AUTH_FAILED", stage: "CONNECTION",
    message: audit.GENERIC_ERROR_MESSAGE });
  assert.doesNotMatch(JSON.stringify(diagnostic), /secreto|datos|stack|uri|hostname/i);
});

test("fuente usa solo PRODUCTION_MONGO_URI y no contiene escrituras", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "audit-legacy-orders-production.js"), "utf8");
  assert.match(source, /environment\.PRODUCTION_MONGO_URI/);
  assert.doesNotMatch(source, /environment\.(?:MONGO_URI|STAGING_MONGO_URI)/);
  assert.doesNotMatch(source, /dotenv|mongoose/i);
  assert.doesNotMatch(source, /\.(?:insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|createIndex|dropIndex|bulkWrite|save)\s*\(/);
});
