const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");
const Categoria = require("../models/Categoria");
const Producto = require("../models/Producto");
const Combo = require("../models/Combo");
const Cupon = require("../models/Cupon");

const tenantA = new mongoose.Types.ObjectId();
const tenantB = new mongoose.Types.ObjectId();
const resourceId = new mongoose.Types.ObjectId();

function chain(value) {
  return {
    sort() { return this; }, populate() { return this; },
    async lean() { return value; },
  };
}

test("schemas permiten nombres equivalentes por tenant y declaran unicidad compuesta", () => {
  assert.equal(new Categoria({ tenantId: tenantA, name: "Bebidas", normalizedName: "bebidas" }).validateSync(), undefined);
  assert.equal(new Categoria({ tenantId: tenantB, name: "Bebidas", normalizedName: "bebidas" }).validateSync(), undefined);
  assert.equal(new Producto({ tenantId: tenantA, name: "Coca Cola", category: "Bebidas", price: 30 }).validateSync(), undefined);
  assert.equal(new Producto({ tenantId: tenantB, name: "Coca Cola", category: "Bebidas", price: 30 }).validateSync(), undefined);
  assert.ok(Categoria.schema.indexes().some(([keys, options]) => keys.tenantId === 1 && keys.normalizedName === 1 && options.unique));
  assert.ok(Cupon.schema.indexes().some(([keys, options]) => keys.tenantId === 1 && keys.code === 1 && options.unique));
  assert.equal(Cupon.schema.path("code").options.unique, undefined);
  assert.equal(Producto.schema.path("legacyId").options.unique, undefined);
  assert.equal(Combo.schema.path("tenantId").options.required, true);
});

test("listados administrativos filtran por req.tenantId e ignoran body/query", async () => {
  const observations = [];
  const cases = [
    ["controllers/adminCategoryController.js", "models/Categoria.js", "listCategories"],
    ["controllers/adminProductController.js", "models/Producto.js", "listProducts"],
    ["controllers/adminComboController.js", "models/Combo.js", "listCombos"],
    ["controllers/adminCouponController.js", "models/Cupon.js", "listCoupons"],
  ];
  for (const [modulePath, modelPath, method] of cases) {
    const context = loadWithMocks(modulePath, {
      [modelPath]: { find: query => { observations.push(query); return chain([]); } },
    });
    await context.loaded[method]({ tenantId: tenantA, body: { tenantId: tenantB }, query: { tenantId: tenantB } }, responseRecorder());
    context.restore();
  }
  observations.forEach(query => assert.equal(String(query.tenantId), String(tenantA)));
});

test("Tenant B no actualiza ni elimina Producto A por ObjectId", async () => {
  const queries = [];
  const context = loadWithMocks("controllers/adminProductController.js", {
    "models/Categoria.js": { findOne: () => chain({ _id: "category-a" }) },
    "models/Producto.js": {
      findOneAndUpdate: async query => { queries.push(query); return null; },
      findOneAndDelete: async query => { queries.push(query); return null; },
    },
  });
  const req = { tenantId: tenantB, params: { id: String(resourceId) }, body: { name: "Coca", category: "Bebidas", price: 30, tenantId: tenantA } };
  assert.equal((await invoke(context.loaded.updateProduct, req)).statusCode, 404);
  assert.equal((await invoke(context.loaded.deleteProduct, req)).statusCode, 404);
  queries.forEach(query => assert.equal(String(query.tenantId), String(tenantB)));
  context.restore();
});

test("Combo rechaza productId y excludedProductIds de otro tenant", async () => {
  const productB = new mongoose.Types.ObjectId();
  const context = loadWithMocks("controllers/adminComboController.js", {
    "models/Categoria.js": { findOne: () => chain({ _id: "category-a" }) },
    "models/Producto.js": {
      findOne: () => chain(null),
      countDocuments: async () => 0,
      find: () => chain([{ _id: resourceId, price: 30 }]),
    },
    "models/Combo.js": { create: async value => value },
  });
  const base = { tenantId: tenantA, params: {}, body: { name: "Combo", comboPrice: 50 } };
  let response = await invoke(context.loaded.createCombo, { ...base, body: { ...base.body, items: [{ mode: "product", productId: String(productB), cantidad: 1 }] } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /disponible/i);
  response = await invoke(context.loaded.createCombo, { ...base, body: { ...base.body, items: [{ mode: "category", category: "Bebidas", excludedProductIds: [String(productB)], cantidad: 1 }] } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /no pertenece/i);
  context.restore();
});

test("Cupon VERANO20 se consulta y crea dentro del tenant autenticado", async () => {
  const observed = [];
  const context = loadWithMocks("controllers/adminCouponController.js", {
    "models/Cupon.js": {
      findOne: query => { observed.push(query); return chain(null); },
      create: async value => { observed.push(value); return value; },
    },
  });
  const res = await invoke(context.loaded.createCoupon, {
    tenantId: tenantA,
    body: { tenantId: tenantB, code: "VERANO20", type: "percent", value: 20 },
    params: {}, query: { tenantId: tenantB },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(String(observed[0].tenantId), String(tenantA));
  assert.equal(String(observed[1].tenantId), String(tenantA));
  context.restore();
});

test("backfill sólo toca tenant ausente/null y repetirlo usa el mismo filtro", async () => {
  const calls = [];
  const model = { updateMany: async (...args) => { calls.push(args); return { modifiedCount: calls.length === 1 ? 2 : 0 }; } };
  const context = loadWithMocks("services/catalogBackfillService.js", {
    "models/Categoria.js": model, "models/Producto.js": model,
    "models/Combo.js": model, "models/Cupon.js": model,
  });
  await context.loaded.backfillLegacyCatalogTenant({ _id: tenantA });
  await context.loaded.backfillLegacyCatalogTenant({ _id: tenantA });
  assert.equal(calls.length, 8);
  calls.forEach(([filter, update]) => {
    assert.deepEqual(filter, { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] });
    assert.equal(String(update.$set.tenantId), String(tenantA));
  });
  context.restore();
});

test("sincronizaciones legacy buscan y crean exclusivamente dentro de Marisco Alegre", async () => {
  for (const [modulePath, modelPath, method] of [
    ["services/categorySyncService.js", "models/Categoria.js", "syncLegacyCategories"],
    ["services/productSyncService.js", "models/Producto.js", "syncLegacyProducts"],
  ]) {
    const observed = [];
    const context = loadWithMocks(modulePath, {
      [modelPath]: {
        findOne: async query => { observed.push(query); return { active: true, legacyId: "p", source: "admin", order: 0, save: async () => {} }; },
        create: async value => { observed.push(value); return value; },
      },
    });
    await context.loaded[method]({ _id: tenantA });
    assert.ok(observed.length);
    observed.forEach(value => assert.equal(String(value.tenantId), String(tenantA)));
    context.restore();
  }
});

async function invoke(controller, req) {
  const res = responseRecorder();
  let forwarded;
  await controller(req, res, error => { forwarded = error; });
  if (forwarded) throw forwarded;
  return res;
}
