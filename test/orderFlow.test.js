const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks } = require("../test-support/moduleMocks");

function setup() {
  const sent = [];
  const whatsapp = {
    sendText: async (to, body) => sent.push({ type: "text", to, body }),
    sendButtons: async (to, body, buttons) => sent.push({ type: "buttons", to, body, buttons }),
  };
  const context = loadWithMocks("services/orderFlowService.js", {
    "services/whatsappService.js": whatsapp,
    "services/orderService.js": {
      createConfirmedOrder: async () => ({}),
      updateLatestActiveOrder: async () => ({}),
    },
  });
  return { ...context, sent };
}

function client(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439011", tenantId: "507f1f77bcf86cd799439012",
    numero: "5215512345678", nombre: "", direccion: null,
    pedidos: [{ productId: "p0", nombre: "Camarones", precio: 180, cantidad: 2 }],
    historialPedidos: [], estadoPedido: "armando", paso: "inicio",
    productoPendiente: null, async save() { this.saves = (this.saves || 0) + 1; },
    ...overrides,
  };
}

test("confirmOrder solicita nombre cuando aún no existe", async () => {
  const context = setup();
  const cliente = client();
  await context.loaded.confirmOrder(cliente);
  assert.equal(cliente.paso, "esperando_nombre");
  assert.match(context.sent[0].body, /nombre/i);
  context.restore();
});

test("confirmOrder solicita ubicación cuando ya conoce el nombre", async () => {
  const context = setup();
  const cliente = client({ nombre: "Ana" });
  await context.loaded.confirmOrder(cliente);
  assert.equal(cliente.paso, "esperando_ubicacion");
  assert.match(context.sent[0].body, /ubicaci/i);
  context.restore();
});

test("finalizeOrder confirma y conserva el carrito", async () => {
  const context = setup();
  const cliente = client({ nombre: "Ana", direccion: { latitude: 1, longitude: 2 } });
  await context.loaded.finalizeOrder(cliente);
  assert.equal(cliente.estadoPedido, "confirmado");
  assert.equal(cliente.paso, "inicio");
  assert.equal(cliente.pedidos.length, 1);
  assert.match(context.sent[0].body, /360/);
  context.restore();
});

test("saveToHistory archiva entrega y limpia el pedido activo", async () => {
  const context = setup();
  const cliente = client({ nombre: "Ana", direccion: { latitude: 1, longitude: 2 } });
  await context.loaded.saveToHistory(cliente, "entregado");
  assert.equal(cliente.historialPedidos.length, 1);
  assert.equal(cliente.historialPedidos[0].total, 360);
  assert.equal(cliente.historialPedidos[0].estadoFinal, "entregado");
  assert.deepEqual(cliente.pedidos, []);
  assert.equal(cliente.estadoPedido, "sin_pedido");
  context.restore();
});
