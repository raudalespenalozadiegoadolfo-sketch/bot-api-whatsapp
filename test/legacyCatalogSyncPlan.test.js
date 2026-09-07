const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const {
  DATABASE_NAME,
  TENANT_SLUG,
  buildSyncPlan,
  planLegacyCatalogSync,
} = require("../scripts/plan-legacy-catalog-sync");

function readChain(value, calls, collection, projection) {
  calls.push({ operation: "find", collection, projection });
  return { toArray: async () => value };
}

test("conserva la base y el tenant explícitos", () => {
  assert.equal(DATABASE_NAME, "marisco_alegre_staging");
  assert.equal(TENANT_SLUG, "marisco-alegre");
});

test("resuelve tenant por slug, lee sólo colecciones permitidas y no escribe", async () => {
  const tenantId = new ObjectId();
  const calls = [];
  const db = {
    collection(name) {
      assert.deepEqual(["tenants", "categorias", "productos"].includes(name), true);
      return {
        findOne: async (filter, options) => {
          calls.push({ operation: "findOne", collection: name, filter, options });
          return { _id: tenantId, slug: TENANT_SLUG };
        },
        find: (filter, options) => readChain([], calls, name, options.projection),
      };
    },
  };

  const result = await planLegacyCatalogSync(db);

  assert.equal(result.database, DATABASE_NAME);
  assert.equal(result.tenantSlug, TENANT_SLUG);
  assert.deepEqual(calls[0].filter, { slug: TENANT_SLUG });
  assert.ok(calls.every(call => ["findOne", "find"].includes(call.operation)));
  assert.equal(calls.some(call => /update|insert|delete|save|bulk|index/i.test(call.operation)), false);
});

test("cuenta faltantes, actualizables, duplicados y registros fuera del tenant", () => {
  const tenantId = new ObjectId();
  const source = {
    categories: [
      { normalizedName: "mariscos", order: 0 },
      { normalizedName: "bebidas", order: 1 },
    ],
    products: [
      { legacyId: "p0", name: "A", category: "Mariscos", type: "food", price: 10, order: 0 },
      { legacyId: "p1", name: "B", category: "Bebidas", type: "drink", price: 20, order: 1 },
    ],
  };
  const result = buildSyncPlan({
    source,
    categories: [
      { tenantId, normalizedName: "mariscos", active: false, order: 3 },
      { tenantId, normalizedName: "mariscos", active: true, order: 0 },
    ],
    products: [
      { tenantId, legacyId: "p0", source: "legacy", name: "A", category: "Mariscos", type: "food", price: 11, order: 0 },
      { tenantId, legacyId: "p0", source: "legacy", name: "A", category: "Mariscos", type: "food", price: 11, order: 0 },
    ],
    recordsOutsideExpectedTenant: 2,
  });

  assert.deepEqual(result, {
    sourceCategories: 2,
    sourceProducts: 2,
    existingCategories: 1,
    existingProducts: 1,
    missingCategories: 1,
    missingProducts: 1,
    updateCandidates: 1,
    possibleDuplicates: 2,
    recordsOutsideExpectedTenant: 2,
  });
});

test("las pruebas no conectan a MongoDB real", async () => {
  const db = {
    collection() {
      throw new Error("No debe conectarse durante esta prueba");
    },
  };
  await assert.rejects(() => planLegacyCatalogSync(db), /No debe conectarse/);
});