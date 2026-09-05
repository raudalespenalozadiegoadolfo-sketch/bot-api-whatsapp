const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const {
  COLLECTIONS,
  DATABASE_NAME,
  auditCatalog,
  classifyTenantIds,
} = require("../scripts/audit-legacy-catalog");

function collectionMock(documents, calls) {
  return {
    find(filter, options) {
      calls.push({ operation: "find", filter, options });
      return { toArray: async () => documents };
    },
  };
}

test("selecciona explícitamente marisco_alegre_staging y no depende de la URI", () => {
  const source = require("fs").readFileSync(require.resolve("../scripts/audit-legacy-catalog"), "utf8");
  assert.equal(DATABASE_NAME, "marisco_alegre_staging");
  assert.match(source, /client\.db\(DATABASE_NAME\)/);
  assert.doesNotMatch(source, /client\.db\(\)/);
});

test("clasifica total, ObjectId, null, ausente e inválido sin castear valores", () => {
  const validTenant = new ObjectId();
  const result = classifyTenantIds([
    { tenantId: validTenant },
    { tenantId: null },
    {},
    { tenantId: "507f1f77bcf86cd799439011" },
    { tenantId: 42 },
  ]);

  assert.deepEqual(result, {
    total: 5,
    tenantIdObjectId: 1,
    tenantIdNull: 1,
    tenantIdMissing: 1,
    tenantIdInvalid: 2,
  });
  assert.equal(result.tenantIdNull + result.tenantIdMissing + result.tenantIdObjectId + result.tenantIdInvalid, result.total);
});

test("audita únicamente las cuatro colecciones mediante lectura nativa proyectada", async () => {
  const calls = [];
  const documents = {
    categorias: [{ tenantId: new ObjectId() }, { tenantId: null }],
    productos: [{}],
    combos: [{ tenantId: "legacy" }],
    cupons: [{ tenantId: new ObjectId() }, { tenantId: null }, {}],
  };
  const db = {
    collection(name) {
      assert.ok(COLLECTIONS.includes(name));
      return collectionMock(documents[name], calls);
    },
  };

  const result = await auditCatalog(db);

  assert.deepEqual(result, {
    mode: "READ_ONLY",
    collections: {
      categorias: { total: 2, tenantIdObjectId: 1, tenantIdNull: 1, tenantIdMissing: 0, tenantIdInvalid: 0 },
      productos: { total: 1, tenantIdObjectId: 0, tenantIdNull: 0, tenantIdMissing: 1, tenantIdInvalid: 0 },
      combos: { total: 1, tenantIdObjectId: 0, tenantIdNull: 0, tenantIdMissing: 0, tenantIdInvalid: 1 },
      cupons: { total: 3, tenantIdObjectId: 1, tenantIdNull: 1, tenantIdMissing: 1, tenantIdInvalid: 0 },
    },
  });
  assert.deepEqual(calls.map(call => call.operation), ["find", "find", "find", "find"]);
  calls.forEach(call => {
    assert.deepEqual(call.filter, {});
    assert.deepEqual(call.options, { projection: { _id: 0, tenantId: 1 } });
  });
});

test("no conecta durante las pruebas y rechaza colecciones fuera de alcance", async () => {
  const db = { collection: () => { throw new Error("No debe accederse a esta colección"); } };
  await assert.rejects(() => require("../scripts/audit-legacy-catalog").auditCollection(db, "orders"), /no permitida/);
});

test("la API de auditoría no expone operaciones de escritura ni de índices", () => {
  const source = require("fs").readFileSync(require.resolve("../scripts/audit-legacy-catalog"), "utf8");
  for (const operation of [
    "update", "save", "insert", "delete", "bulkWrite", "createIndex", "dropIndex", "syncIndexes", "migrate",
  ]) {
    assert.equal(source.includes(`.${operation}`), false, `No debe usar .${operation}`);
  }
});