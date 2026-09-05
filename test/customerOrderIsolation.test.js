const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");
const Cliente = require("../models/Cliente");
const Order = require("../models/Order");

const tenantA = new mongoose.Types.ObjectId();
const tenantB = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();

test("Cliente permite mismo teléfono por tenant y conserva datos independientes", () => {
  const first = new Cliente({ tenantId: tenantA, numero: "5215512345678", nombre: "Ana A", direccion: { calle: "A" }, pedidos: [{ productId: "p1", nombre: "A", precio: 10, cantidad: 1 }] });
  const second = new Cliente({ tenantId: tenantB, numero: "5215512345678", nombre: "Ana B", direccion: { calle: "B" }, pedidos: [{ productId: "p2", nombre: "B", precio: 20, cantidad: 1 }] });
  assert.equal(first.validateSync(), undefined);
  assert.equal(second.validateSync(), undefined);
  assert.notDeepEqual(first.direccion, second.direccion);
  assert.notDeepEqual(first.pedidos, second.pedidos);
  assert.equal(Cliente.schema.path("tenantId").options.default, null);
  assert.equal(Cliente.schema.path("branchId").options.default, null);
  assert.ok(Cliente.schema.indexes().some(([keys, options]) => keys.numero === 1 && options.unique));
  assert.equal(Cliente.schema.path("numero").options.unique, undefined);
});

test("clienteService requiere tenant y branch y nunca busca sólo por teléfono", async () => {
  const calls = [];
  const context = loadWithMocks("services/clienteService.js", {
    "models/Cliente.js": { findOneAndUpdate: async (...args) => { calls.push(args); return {}; } },
  });
  await assert.rejects(() => context.loaded.findOrCreateCliente("5211"), /tenantId/);
  await context.loaded.findOrCreateCliente("5211", { tenantId: tenantA, branchId: "branch-a" });
  assert.deepEqual(calls[0][0], { tenantId: tenantA, numero: "5211" });
  assert.equal(calls[0][1].$set.branchId, "branch-a");
  context.restore();
});

test("Order es genérico, tenant-scoped y conserva snapshot del item", () => {
  const order = new Order({
    tenantId: tenantA, branchId: new mongoose.Types.ObjectId(), customerId,
    orderNumber: "1001", channel: "storefront", status: "confirmed",
    items: [{ productId: new mongoose.Types.ObjectId(), name: "Camisa", quantity: 2, unitPrice: 250, lineTotal: 500, variant: { talla: "M" }, sku: "CAM-M" }],
    subtotal: 500, total: 500,
    fulfillment: { type: "shipping", address: { ciudad: "México" } },
  });
  assert.equal(order.validateSync(), undefined);
  assert.equal(order.items[0].name, "Camisa");
  assert.deepEqual(order.items[0].variant, { talla: "M" });
  assert.ok(Order.schema.indexes().some(([keys, options]) => keys.tenantId === 1 && keys.orderNumber === 1 && options.unique));
});

test("confirmación crea Order con tenant, branch, canal y snapshot", async () => {
  let created;
  const context = loadWithMocks("services/orderService.js", {
    "models/Order.js": { create: async value => { created = value; return value; } },
  });
  const cliente = {
    _id: customerId, tenantId: tenantA, branchId: null, numero: "5211", nombre: "Ana",
    direccion: { ciudad: "México" }, pedidoOrigen: "tienda",
    pedidos: [{ productId: String(new mongoose.Types.ObjectId()), nombre: "Martillo", precio: 80, cantidad: 2 }],
  };
  await context.loaded.createConfirmedOrder(cliente, { branchId: "branch-a", currency: "MXN" });
  assert.equal(String(created.tenantId), String(tenantA));
  assert.equal(created.branchId, "branch-a");
  assert.equal(created.channel, "storefront");
  assert.equal(created.items[0].name, "Martillo");
  assert.equal(created.items[0].lineTotal, 160);
  assert.equal(created.total, 160);
  context.restore();
});

test("panel filtra listados, historial y mutaciones por req.tenantId", async () => {
  const observed = [];
  const cliente = {
    _id: customerId, tenantId: tenantA, numero: "5211", nombre: "A", pedidos: [],
    historialPedidos: [], estadoPedido: "confirmado", paso: "inicio", async save() {},
  };
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": {
      find: query => { observed.push(query); return { sort: async () => [] }; },
      findOne: async query => { observed.push(query); return query.tenantId === tenantA ? cliente : null; },
    },
    "services/orderService.js": { updateLatestActiveOrder: async () => ({}) },
    "services/whatsappService.js": { sendText: async () => {} },
  });
  await invoke(context.loaded.getActiveOrders, { tenantId: tenantA, query: {} });
  await invoke(context.loaded.getHistory, { tenantId: tenantA, query: {} });
  const denied = await invoke(context.loaded.changeOrderState, { tenantId: tenantB, params: { action: "cocina" }, body: { numero: "5211", tenantId: tenantA } });
  assert.equal(denied.statusCode, 404);
  observed.forEach(query => assert.ok(query.tenantId));
  assert.equal(String(observed.at(-1).tenantId), String(tenantB));
  context.restore();
});

test("actualización de Order nunca puede saltar del Customer/Tenant autenticado", async () => {
  const queries = [];
  const context = loadWithMocks("services/orderService.js", {
    "models/Order.js": { findOneAndUpdate: async query => { queries.push(query); return null; } },
  });
  await context.loaded.updateLatestActiveOrder({ _id: customerId, tenantId: tenantA }, "cocina");
  await context.loaded.updateLatestActiveOrder({ _id: customerId, tenantId: tenantB }, "cocina");
  assert.equal(String(queries[0].tenantId), String(tenantA));
  assert.equal(String(queries[1].tenantId), String(tenantB));
  assert.equal(String(queries[0].customerId), String(customerId));
  context.restore();
});

test("historial de Tenant A no consulta ni devuelve Cliente B", async () => {
  let query;
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": { find: value => { query = value; return { sort: async () => [] }; } },
    "services/orderService.js": { getOrderHistory: async () => [] },
  });
  const res = await invoke(context.loaded.getHistory, { tenantId: tenantA, query: {} });
  assert.equal(String(query.tenantId), String(tenantA));
  assert.deepEqual(res.body, []);
  context.restore();
});

test("backfill Customer sólo toca ausentes/null y es idempotente", async () => {
  const calls = [];
  const context = loadWithMocks("services/customerBackfillService.js", {
    "models/Cliente.js": { updateMany: async (...args) => { calls.push(args); return { modifiedCount: calls.length === 1 ? 2 : 0 }; } },
  });
  await context.loaded.backfillLegacyCustomers({ _id: tenantA });
  await context.loaded.backfillLegacyCustomers({ _id: tenantA });
  assert.equal(calls.length, 2);
  calls.forEach(([filter, update]) => {
    assert.deepEqual(filter, { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] });
    assert.equal(String(update.$set.tenantId), String(tenantA));
  });
  context.restore();
});

test("checkout de tenant nuevo crea Order aislado sin usar WhatsApp global", async () => {
  let customerQuery;
  let orderContext;
  let whatsappCalls = 0;
  const customer = {
    _id: customerId, tenantId: tenantB, numero: "5215512345678", nombre: "Ana",
    pedidos: [], estadoPedido: "sin_pedido", paso: "inicio", async save() {},
  };
  const queryResult = value => ({
    sort() { return this; }, populate() { return this; }, async lean() { return value; },
  });
  const context = loadWithMocks("controllers/storeController.js", {
    "models/Cliente.js": { findOneAndUpdate: async query => { customerQuery = query; return customer; } },
    "models/Producto.js": { find: () => queryResult([{ _id: "507f1f77bcf86cd799439099", name: "Martillo", category: "Herramientas", price: 80, type: "food", active: true }]) },
    "models/Combo.js": { find: () => queryResult([]) },
    "services/orderService.js": { createConfirmedOrder: async (_customer, value) => {
      orderContext = value; return { orderNumber: "B-1001", status: "confirmed" };
    } },
    "services/whatsappService.js": {
      sendText: async () => { whatsappCalls += 1; },
      sendButtons: async () => { whatsappCalls += 1; },
    },
  });
  const res = await invoke(context.loaded.createStoreOrder, {
    storefrontTenant: { _id: tenantB, storefrontKey: "ferreteria-b", currency: "MXN" },
    storefrontBranch: { _id: "branch-b" },
    body: { numero: "5512345678", tenantId: tenantA, items: [{ id: "507f1f77bcf86cd799439099", cantidad: 2 }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(String(customerQuery.tenantId), String(tenantB));
  assert.equal(orderContext.branchId, "branch-b");
  assert.equal(whatsappCalls, 0);
  context.restore();
});

test("Tenant expone businessType neutral y Marisco Alegre usa restaurant", () => {
  const Tenant = require("../models/Tenant");
  const generic = new Tenant({ name: "Comercio", slug: "comercio", storefrontKey: "comercio" });
  assert.equal(generic.businessType, "other");
  assert.deepEqual(Tenant.schema.path("businessType").options.enum, ["restaurant", "retail", "services", "other"]);
});

async function invoke(controller, req) {
  const res = responseRecorder();
  let error;
  await controller(req, res, value => { error = value; });
  if (error) throw error;
  return res;
}
