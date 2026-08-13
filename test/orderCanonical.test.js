const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");

const tenantA = "tenant-a";
const tenantB = "tenant-b";

function queryResult(value) {
  return {
    sort() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function order(overrides = {}) {
  return {
    _id: "order-a", tenantId: tenantA, customerId: "customer-a", orderNumber: "1",
    status: "confirmed", legacyStatus: "confirmado", channel: "whatsapp",
    items: [{ name: "Camarones", quantity: 2, unitPrice: 180, lineTotal: 360 }],
    total: 360, customerSnapshot: { name: "Ana", phone: "5211" },
    fulfillment: { address: { calle: "A" } }, createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"), ...overrides,
  };
}

function serviceSetup({ orders = [], found = null, updated = null } = {}) {
  const calls = { find: [], findOne: [], update: [] };
  const Order = {
    find: query => { calls.find.push(query); return queryResult(orders); },
    findOne: query => { calls.findOne.push(query); return queryResult(found); },
    findOneAndUpdate: async (query, update, options) => {
      calls.update.push({ query, update, options }); return updated;
    },
    create: async value => value,
  };
  const context = loadWithMocks("services/orderService.js", { "models/Order.js": Order });
  return { ...context, calls };
}

test("Tenant A lista sólo Orders A y exige tenant explícito", async () => {
  const context = serviceSetup({ orders: [order()] });
  await assert.rejects(() => context.loaded.getActiveOrders(), /tenantId/);
  await context.loaded.getActiveOrders(tenantA);
  assert.equal(context.calls.find[0].tenantId, tenantA);
  context.restore();
});

test("Tenant B lista sólo Orders B", async () => {
  const context = serviceSetup();
  await context.loaded.getActiveOrders(tenantB);
  assert.equal(context.calls.find[0].tenantId, tenantB);
  context.restore();
});

test("dos tenants pueden usar orderNumber 1 mediante consulta compuesta", async () => {
  const context = serviceSetup();
  await context.loaded.findTenantOrderByNumber(tenantA, "1");
  await context.loaded.findTenantOrderByNumber(tenantB, "1");
  assert.deepEqual(context.calls.findOne.map(value => value.tenantId), [tenantA, tenantB]);
  context.restore();
});

test("Tenant A no obtiene Order B por ObjectId", async () => {
  const context = serviceSetup();
  await context.loaded.findTenantOrderById(tenantA, "order-b");
  assert.deepEqual(context.calls.findOne[0], { _id: "order-b", tenantId: tenantA });
  context.restore();
});

for (const [label, method, expected] of [
  ["modifica estado", "updateOrderStatus", "processing"],
  ["cancela", "cancelOrder", "cancelled"],
  ["entrega", "completeOrder", "completed"],
]) {
  test(`Tenant A no ${label} de Order B`, async () => {
    const context = serviceSetup();
    await context.loaded[method](tenantA, "order-b", method === "updateOrderStatus" ? "cocina" : "nota");
    assert.deepEqual(context.calls.update[0].query, { _id: "order-b", tenantId: tenantA });
    assert.equal(context.calls.update[0].update.$set.status, expected);
    context.restore();
  });
}

test("historial y dashboard siempre filtran por tenant", async () => {
  const context = serviceSetup();
  await context.loaded.getOrderHistory(tenantA, 10);
  await context.loaded.getDashboardMetrics(tenantA, new Date("2026-01-01"));
  assert.ok(context.calls.find.every(query => query.tenantId === tenantA));
  context.restore();
});

test("pedido entregado y cancelado permanecen como Order", async () => {
  const context = serviceSetup({ updated: order({ status: "completed" }) });
  assert.ok(await context.loaded.completeOrder(tenantA, "order-a"));
  assert.ok(await context.loaded.cancelOrder(tenantA, "order-a", "motivo"));
  assert.equal(context.calls.update.length, 2);
  context.restore();
});

test("getCustomerOrders exige tenant y customer", async () => {
  const context = serviceSetup();
  await assert.rejects(() => context.loaded.getCustomerOrders(null, "customer-a"), /tenantId/);
  await context.loaded.getCustomerOrders(tenantA, "customer-a");
  assert.deepEqual(context.calls.find[0], { tenantId: tenantA, customerId: "customer-a" });
  context.restore();
});

async function invoke(controller, req) {
  const res = responseRecorder(); let error;
  await controller(req, res, value => { error = value; });
  if (error) throw error;
  return res;
}

test("panel usa Order como fuente principal aunque Cliente conserve snapshot", async () => {
  let legacyReads = 0;
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": { find: () => { legacyReads += 1; return queryResult([]); } },
    "services/orderService.js": { getActiveOrders: async () => [order()] },
  });
  const res = await invoke(context.loaded.getActiveOrders, { tenantId: tenantA, query: {} });
  assert.equal(res.body[0].id, "order-a");
  assert.equal(legacyReads, 0);
  context.restore();
});

test("fallback legacy se usa sólo si Order no devuelve resultados", async () => {
  let legacyReads = 0;
  const legacy = { _id: "c1", numero: "5211", pedidos: [], estadoPedido: "confirmado" };
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": { find: () => { legacyReads += 1; return queryResult([legacy]); } },
    "services/orderService.js": { getActiveOrders: async () => [] },
  });
  await invoke(context.loaded.getActiveOrders, { tenantId: tenantA, query: {} });
  assert.equal(legacyReads, 1);
  context.restore();
});

test("fallback legacy conserva filtro tenant y nunca cruza empresas", async () => {
  let query;
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": { find: value => { query = value; return queryResult([]); } },
    "services/orderService.js": { getOrderHistory: async () => [] },
  });
  await invoke(context.loaded.getHistory, { tenantId: tenantB, query: {} });
  assert.equal(query.tenantId, tenantB);
  context.restore();
});

test("dashboard canónico no consulta Cliente cuando existen métricas Order", async () => {
  let legacyReads = 0;
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": { find: () => { legacyReads += 1; return queryResult([]); } },
    "services/orderService.js": { getDashboardMetrics: async () => ({ activos: 1, confirmados: 1, cocina: 0, camino: 0, ventasHoy: 0, historial: 2, sourceCount: 2 }) },
  });
  const res = await invoke(context.loaded.getDashboard, { tenantId: tenantA, query: {} });
  assert.equal(res.body.historial, 2);
  assert.equal(legacyReads, 0);
  context.restore();
});
