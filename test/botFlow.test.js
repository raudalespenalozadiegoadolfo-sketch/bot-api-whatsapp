const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks } = require("../test-support/moduleMocks");

test("flujo WhatsApp actual: inicio, producto, cantidad, nombre y ubicación", async () => {
  const sent = [];
  const cliente = {
    numero: "5215512345678", nombre: "", direccion: null, pedidos: [],
    historialPedidos: [], productoPendiente: null, pedidoOrigen: "whatsapp",
    paso: "inicio", estadoPedido: "sin_pedido",
    async save() { this.saves = (this.saves || 0) + 1; },
  };
  const whatsapp = {
    sendText: async (to, body) => sent.push({ type: "text", to, body }),
    sendImage: async (to, image, caption) => sent.push({ type: "image", to, image, caption }),
    sendButtons: async (to, body, buttons) => sent.push({ type: "buttons", to, body, buttons }),
    sendList: async (to, header, body, button, rows) => sent.push({ type: "list", to, header, body, button, rows }),
  };
  const context = loadWithMocks("controllers/botFlowController.js", {
    "services/messageService.js": { alreadyProcessed: async () => false },
    "services/clienteService.js": { findOrCreateCliente: async () => cliente },
    "services/whatsappService.js": whatsapp,
    "config/env.js": { STORE_URL: "https://store.test/tienda", RESTAURANT_NAME: "Marisco Alegre", PUBLIC_URL: "https://store.test" },
  });
  const message = (id, type, value) => type === "text"
    ? { id, from: cliente.numero, type, text: { body: value } }
    : type === "location"
      ? { id, from: cliente.numero, type, location: value }
      : { id, from: cliente.numero, type: "interactive", interactive: { button_reply: { id: value } } };

  await context.loaded.handleIncoming(message("1", "text", "hola"));
  assert.ok(sent.some(item => item.type === "list"));

  await context.loaded.handleIncoming(message("2", "button", "product_p0"));
  assert.equal(cliente.paso, "esperando_cantidad");
  assert.equal(cliente.productoPendiente.id, "p0");

  await context.loaded.handleIncoming(message("3", "text", "2"));
  assert.equal(cliente.pedidos[0].cantidad, 2);
  assert.equal(cliente.estadoPedido, "armando");

  await context.loaded.handleIncoming(message("4", "button", "show_cart"));
  assert.match(sent.at(-1).body, /360/);

  await context.loaded.handleIncoming(message("5", "button", "confirm_order"));
  assert.equal(cliente.paso, "esperando_nombre");

  await context.loaded.handleIncoming(message("6", "text", "Ana"));
  assert.equal(cliente.nombre, "Ana");
  assert.equal(cliente.paso, "esperando_ubicacion");

  await context.loaded.handleIncoming(message("7", "location", { latitude: 19.4, longitude: -99.1 }));
  assert.equal(cliente.estadoPedido, "confirmado");
  assert.deepEqual(cliente.direccion, { latitude: 19.4, longitude: -99.1 });
  assert.match(sent.at(-1).body, /360/);
  context.restore();
});

test("un messageId duplicado no vuelve a procesar al cliente", async () => {
  let clientCalls = 0;
  const context = loadWithMocks("controllers/botFlowController.js", {
    "services/messageService.js": { alreadyProcessed: async () => true },
    "services/clienteService.js": { findOrCreateCliente: async () => { clientCalls += 1; } },
    "services/whatsappService.js": { sendText: async () => {}, sendImage: async () => {}, sendButtons: async () => {}, sendList: async () => {} },
    "config/env.js": {},
  });
  await context.loaded.handleIncoming({ id: "duplicate", from: "5211", type: "text", text: { body: "hola" } });
  assert.equal(clientCalls, 0);
  context.restore();
});
