const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");

function client(overrides = {}) {
  return {
    _id: "client-1", numero: "5215512345678", nombre: "Ana",
    direccion: { latitude: 1, longitude: 2 },
    pedidos: [{ productId: "p0", nombre: "Camarones", precio: 180, cantidad: 2 }],
    historialPedidos: [], estadoPedido: "confirmado", paso: "inicio",
    pedidoOrigen: "whatsapp", async save() { this.saved = true; }, ...overrides,
  };
}

function setup(cliente) {
  const sent = [];
  const Cliente = {
    find(query) {
      const values = query.historialPedidos ? [cliente] : [cliente];
      return { sort: async () => values, then(resolve) { return Promise.resolve(values).then(resolve); } };
    },
    findOne: async ({ numero }) => numero === cliente.numero ? cliente : null,
  };
  const context = loadWithMocks("controllers/panelController.js", {
    "models/Cliente.js": Cliente,
    "services/whatsappService.js": { sendText: async (...args) => sent.push(args) },
  });
  return { ...context, sent };
}

async function call(controller, req = {}) {
  const res = responseRecorder();
  let error;
  await controller(req, res, value => { error = value; });
  if (error) throw error;
  return res;
}

test("consulta y serializa pedidos activos", async () => {
  const context = setup(client());
  const res = await call(context.loaded.getActiveOrders);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].total, 360);
  context.restore();
});

test("permite cambiar directamente de confirmado a en_camino", async () => {
  const cliente = client();
  const context = setup(cliente);
  const res = await call(context.loaded.changeOrderState, { params: { action: "en_camino" }, body: { numero: cliente.numero } });
  assert.equal(res.body.ok, true);
  assert.equal(cliente.estadoPedido, "en_camino");
  assert.equal(context.sent.length, 1);
  context.restore();
});

test("entrega archiva el pedido y limpia el activo", async () => {
  const cliente = client();
  const context = setup(cliente);
  await call(context.loaded.changeOrderState, { params: { action: "entregado" }, body: { numero: cliente.numero } });
  assert.equal(cliente.historialPedidos[0].estadoFinal, "entregado");
  assert.deepEqual(cliente.pedidos, []);
  assert.equal(cliente.estadoPedido, "sin_pedido");
  context.restore();
});

test("cancelación conserva motivo en historial", async () => {
  const cliente = client();
  const context = setup(cliente);
  await call(context.loaded.changeOrderState, { params: { action: "cancelado" }, body: { numero: cliente.numero, motivo: "Sin reparto" } });
  assert.equal(cliente.historialPedidos[0].estadoFinal, "cancelado");
  assert.equal(cliente.historialPedidos[0].motivoCancelacion, "Sin reparto");
  context.restore();
});

test("consulta historial embebido", async () => {
  const cliente = client({
    pedidos: [], estadoPedido: "sin_pedido",
    historialPedidos: [{ _id: "order-1", fecha: new Date("2026-01-01"), estadoFinal: "entregado", pedidos: [], total: 360, numero: "5215512345678" }],
  });
  const context = setup(cliente);
  const res = await call(context.loaded.getHistory, { query: { limit: 10 } });
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].total, 360);
  context.restore();
});
