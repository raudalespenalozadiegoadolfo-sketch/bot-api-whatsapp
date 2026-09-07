const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const Categoria = require("../models/Categoria");
const {
  DATABASE_NAME,
  ERROR_CODES,
  TENANT_SLUG,
  buildSyncPlan,
  main,
  run,
  sourceDocuments,
  syncLegacyCatalog,
} = require("../scripts/sync-legacy-catalog-staging");

function makeCatalogDocuments(tenantId) {
  const source = sourceDocuments();
  return {
    categories: source.categories.map(category => ({
      _id: new ObjectId(),
      tenantId,
      name: category.name,
      normalizedName: category.normalizedName,
      active: true,
      order: category.order,
    })),
    products: source.products.map(product => ({
      _id: new ObjectId(),
      tenantId,
      legacyId: product.legacyId,
      source: "legacy",
      name: product.name,
      category: product.category,
      price: product.price,
      type: product.type,
      aliases: product.aliases,
      order: product.order,
    })),
  };
}

function dbMock({ tenants, categories, products, calls = [] }) {
  const data = { tenants, categorias: categories, productos: products };
  return {
    databaseName: DATABASE_NAME,
    collection(name) {
      assert.ok(["tenants", "categorias", "productos"].includes(name));
      return {
        find(filter) {
          calls.push({ operation: "find", collection: name, filter });
          return { toArray: async () => data[name].filter(document => !filter.slug || document.slug === filter.slug) };
        },
        insertOne(document) {
          calls.push({ operation: "insertOne", collection: name, document });
          data[name].push({ ...document, _id: new ObjectId() });
          return Promise.resolve({ acknowledged: true });
        },
        updateOne(filter, update) {
          calls.push({ operation: "updateOne", collection: name, filter, update });
          return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
        },
      };
    },
  };
}

test("fija staging y la fuente actual tiene 11 categorias y 42 productos", () => {
  assert.equal(DATABASE_NAME, "marisco_alegre_staging");
  assert.equal(TENANT_SLUG, "marisco-alegre");
  assert.equal(sourceDocuments().categories.length, 11);
  assert.equal(sourceDocuments().products.length, 42);
});

test("DRY_RUN no escribe y reporta el plan completo", async () => {
  const tenantId = new ObjectId();
  const calls = [];
  const result = await syncLegacyCatalog({ db: dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [], products: [], calls }) });
  assert.deepEqual(result, {
    mode: "DRY_RUN", database: DATABASE_NAME, tenantSlug: TENANT_SLUG,
    sourceCategories: 11, sourceProducts: 42, categoriesToCreate: 11, categoriesToUpdate: 0,
    productsToCreate: 42, productsToUpdate: 0, duplicatesDetected: 0, crossTenantConflicts: 0, status: "READY",
  });
  assert.equal(calls.some(call => /insert|update/i.test(call.operation)), false);
});

test("--apply crea 11 categorias y 42 productos sólo en las colecciones permitidas", async () => {
  const tenantId = new ObjectId();
  const calls = [];
  const db = dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [], products: [], calls });
  const result = await syncLegacyCatalog({ db, apply: true });
  assert.deepEqual(result, {
    mode: "APPLY", database: DATABASE_NAME, tenantSlug: TENANT_SLUG,
    categoriesCreated: 11, categoriesUpdated: 0, productsCreated: 42, productsUpdated: 0, status: "COMPLETED",
  });
  assert.equal(calls.filter(call => call.operation === "insertOne" && call.collection === "categorias").length, 11);
  assert.equal(calls.filter(call => call.operation === "insertOne" && call.collection === "productos").length, 42);
});

test("segunda ejecucion no duplica y conserva aislamiento de otros tenants", async () => {
  const tenantId = new ObjectId();
  const otherTenantId = new ObjectId();
  const current = makeCatalogDocuments(tenantId);
  const other = makeCatalogDocuments(otherTenantId);
  const calls = [];
  const result = await syncLegacyCatalog({
    db: dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [...current.categories, ...other.categories], products: [...current.products, ...other.products], calls }),
    apply: true,
  });
  assert.equal(result.categoriesCreated, 0);
  assert.equal(result.productsCreated, 0);
  assert.equal(calls.some(call => call.collection === "tenants" && /insert|update|delete/i.test(call.operation)), false);
  assert.equal(calls.some(call => call.collection !== "tenants" && !["categorias", "productos"].includes(call.collection)), false);
});

test("aborta ante tenant duplicado, categoria ambigua o producto duplicado", async () => {
  const tenantId = new ObjectId();
  const source = sourceDocuments();
  await assert.rejects(() => syncLegacyCatalog({ db: dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }, { _id: new ObjectId(), slug: TENANT_SLUG }], categories: [], products: [] }), apply: true }), { message: ERROR_CODES.DUPLICATE_TENANT });
  await assert.rejects(() => syncLegacyCatalog({ db: dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [{ tenantId, normalizedName: source.categories[0].normalizedName }, { tenantId, normalizedName: source.categories[0].normalizedName }], products: [] }), apply: true }), { message: ERROR_CODES.AMBIGUOUS_CATEGORY });
  await assert.rejects(() => syncLegacyCatalog({ db: dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [], products: [{ tenantId, legacyId: source.products[0].legacyId }, { tenantId, legacyId: source.products[0].legacyId }] }), apply: true }), { message: ERROR_CODES.DUPLICATE_PRODUCT });
});

test("no toca indices ni abre conexion real", async () => {
  const source = sourceDocuments();
  const plan = buildSyncPlan({ tenantId: new ObjectId(), source, categories: [], products: [] });
  assert.equal(plan.categoryCreates.length, 11);
  assert.equal(plan.productCreates.length, 42);
  class ForbiddenClient { constructor() { throw new Error("NO_REAL_CONNECTION"); } }
  await assert.rejects(() => run({ uri: "mongodb://not-used", MongoClientClass: ForbiddenClient }), { message: ERROR_CODES.CONNECTION_FAILED });
  await assert.rejects(() => main([], {}), { message: ERROR_CODES.MONGO_URI_MISSING });
});

test("la primera categoria usa el contrato real y el ObjectId BSON del tenant", () => {
  const tenantId = new ObjectId();
  const source = sourceDocuments();
  const plan = buildSyncPlan({ tenantId, source, categories: [], products: [] });
  const first = plan.categoryCreates[0];
  assert.equal(first.tenantId, undefined);
  const document = { tenantId, ...first, active: true };
  assert.equal(document.tenantId instanceof ObjectId, true);
  assert.equal(new Categoria(document).validateSync(), undefined);
  assert.deepEqual(Object.keys(document).sort(), ["active", "name", "normalizedName", "order", "tenantId"].sort());
});

test("APPLY_FAILED conserva diagnóstico seguro de la primera operación", async () => {
  const tenantId = new ObjectId();
  const db = dbMock({ tenants: [{ _id: tenantId, slug: TENANT_SLUG }], categories: [], products: [] });
  const originalCollection = db.collection;
  db.collection = name => {
    const collection = originalCollection(name);
    if (name === "categorias") {
      collection.insertOne = async () => {
        const error = new Error("secret connection details");
        error.code = 11000;
        error.codeName = "DuplicateKey";
        error.keyPattern = { tenantId: 1, normalizedName: 1 };
        throw error;
      };
    }
    return collection;
  };
  await assert.rejects(
    () => syncLegacyCatalog({ db, apply: true }),
    error => {
      assert.equal(error.message, ERROR_CODES.APPLY_FAILED);
      assert.deepEqual({ stage: error.stage, collection: error.collection, operation: error.operation, mongoCode: error.mongoCode, mongoCodeName: error.mongoCodeName, keyPattern: error.keyPattern }, {
        stage: "APPLY", collection: "categorias", operation: "insertOne", mongoCode: 11000, mongoCodeName: "DuplicateKey", keyPattern: ["tenantId", "normalizedName"],
      });
      assert.equal(error.message.includes("secret"), false);
      return true;
    }
  );
});