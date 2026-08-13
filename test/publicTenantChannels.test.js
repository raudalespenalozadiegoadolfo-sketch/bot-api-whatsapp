const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");

function chain(value) {
  return { sort() { return this; }, populate() { return this; }, async lean() { return value; } };
}

test("payload Meta conserva metadata.phone_number_id por mensaje", () => {
  const { getMessagesFromWebhook } = require("../services/messageService");
  const messages = getMessagesFromWebhook({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "phone-a" }, messages: [{ id: "m1", tenantId: "malicioso" }],
  } }] }] });
  assert.equal(messages[0].webhookMetadata.phoneNumberId, "phone-a");
  assert.equal(messages[0].tenantId, "malicioso");
});

test("webhook resuelve A/B y conserva contextos concurrentes sin confiar en payload", async () => {
  const observed = [];
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": { APP_SECRET: "test", VERIFY_TOKEN: "test" },
    "services/messageService.js": {
      acquireMessage: async () => ({ acquired: true, processingToken: "owner", attempts: 1 }),
      completeMessage: async () => {}, failMessage: async () => {},
      getMessagesFromWebhook: () => [], sanitizeError: error => ({ message: error.message }),
    },
    "services/tenantResolverService.js": {
      resolveTenantFromPhoneNumberId: async phone => ({
        resolved: true, tenantId: `tenant-${phone}`, branchId: `branch-${phone}`,
      }),
    },
    "services/tenantCatalogService.js": {
      createTenantCatalog: tenantId => ({ tenantId }),
    },
    "controllers/botFlowController.js": {
      handleIncoming: async (message, tenant) => {
        await new Promise(resolve => setImmediate(resolve));
        observed.push({ id: message.id, tenantId: tenant.tenantId, catalogTenant: tenant.catalog.tenantId });
      },
    },
    "services/webhookLogger.js": { logWebhookEvent: () => {} },
  });
  await Promise.all([
    context.loaded.processMessages([{ id: "a", tenantId: "tenant-b", webhookMetadata: { phoneNumberId: "a" } }]),
    context.loaded.processMessages([{ id: "b", tenantId: "tenant-a", webhookMetadata: { phoneNumberId: "b" } }]),
  ]);
  assert.deepEqual(observed.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "a", tenantId: "tenant-a", catalogTenant: "tenant-a" },
    { id: "b", tenantId: "tenant-b", catalogTenant: "tenant-b" },
  ]);
  context.restore();
});

test("canal ausente, desconocido o inactivo no adquiere ni procesa mensaje", async () => {
  for (const reason of ["missing_phone_number_id", "channel_not_found", "channel_inactive"]) {
    let acquisitions = 0;
    let flows = 0;
    const context = loadWithMocks("controllers/webhookController.js", {
      "config/env.js": { APP_SECRET: "test", VERIFY_TOKEN: "test" },
      "services/messageService.js": {
        acquireMessage: async () => { acquisitions += 1; return { acquired: true }; },
        completeMessage: async () => {}, failMessage: async () => {},
        getMessagesFromWebhook: () => [], sanitizeError: error => ({ message: error.message }),
      },
      "services/tenantResolverService.js": { resolveTenantFromPhoneNumberId: async () => ({ resolved: false, reason }) },
      "services/tenantCatalogService.js": { createTenantCatalog: () => assert.fail() },
      "controllers/botFlowController.js": { handleIncoming: async () => { flows += 1; } },
      "services/webhookLogger.js": { logWebhookEvent: () => {} },
    });
    await context.loaded.processMessages([{ id: reason, webhookMetadata: {} }]);
    assert.equal(acquisitions, 0);
    assert.equal(flows, 0);
    context.restore();
  }
});

test("catálogo dinámico filtra todas las consultas y IDs por tenant", async () => {
  const queries = [];
  const context = loadWithMocks("services/tenantCatalogService.js", {
    "models/Producto.js": {
      distinct: async (_field, query) => { queries.push(query); return ["Bebidas"]; },
      find: query => { queries.push(query); return chain([]); },
      findOne: query => { queries.push(query); return chain(null); },
    },
    "models/Categoria.js": { find: query => { queries.push(query); return chain([]); } },
  });
  const catalog = context.loaded.createTenantCatalog("tenant-a");
  await catalog.getCategories("drink");
  await catalog.getProducts();
  await catalog.getProductsByCategory("drink", "Bebidas");
  await catalog.findProductById("507f1f77bcf86cd799439011");
  await catalog.getActiveCategories();
  queries.forEach(query => assert.equal(query.tenantId, "tenant-a"));
  context.restore();
});

test("storefront se resuelve por key URL-safe y nunca por tenantId arbitrario", async () => {
  const queries = [];
  const context = loadWithMocks("services/storefrontService.js", {
    "models/Tenant.js": { findOne: query => { queries.push(query); return chain({ _id: "tenant-a" }); } },
  });
  assert.equal((await context.loaded.resolveStorefront("Restaurante-A"))._id, "tenant-a");
  assert.equal(await context.loaded.resolveStorefront("507f1f77bcf86cd799439011?tenantId=x"), null);
  assert.deepEqual(queries[0], {
    storefrontKey: "restaurante-a", status: { $in: ["active", "onboarding"] },
  });
  context.restore();
});

test("storefront A/B obtiene sólo productos y combos de su contexto", async () => {
  const productQueries = [];
  const comboQueries = [];
  const context = loadWithMocks("controllers/storeController.js", {
    "models/Producto.js": { find: query => { productQueries.push(query); return chain([]); } },
    "models/Combo.js": { find: query => { comboQueries.push(query); return chain([]); } },
  });
  for (const tenantId of ["tenant-a", "tenant-b"]) {
    const res = responseRecorder();
    await context.loaded.getMenu({
      storefrontTenant: { _id: tenantId, storefrontKey: `store-${tenantId}` },
      query: { tenantId: tenantId === "tenant-a" ? "tenant-b" : "tenant-a" },
    }, res, error => { if (error) throw error; });
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.products, []);
    assert.deepEqual(res.body.combos, []);
  }
  assert.deepEqual(productQueries.map(query => query.tenantId), ["tenant-a", "tenant-b"]);
  assert.deepEqual(comboQueries.map(query => query.tenantId), ["tenant-a", "tenant-b"]);
  context.restore();
});

test("checkout nuevo se bloquea antes de tocar Cliente y legacy continúa habilitado", async () => {
  let clientCalls = 0;
  const context = loadWithMocks("controllers/storeController.js", {
    "models/Cliente.js": { findOneAndUpdate: async () => { clientCalls += 1; } },
  });
  const res = responseRecorder();
  await context.loaded.createStoreOrder({
    storefrontTenant: { _id: "tenant-b", storefrontKey: "restaurante-b" },
    body: { numero: "5215512345678", tenantId: "tenant-a", items: [{ id: "x" }] },
  }, res, error => { if (error) throw error; });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "checkout_not_enabled");
  assert.equal(clientCalls, 0);
  context.restore();
});
