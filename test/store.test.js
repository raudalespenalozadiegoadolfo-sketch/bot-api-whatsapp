const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");

function queryResult(value) {
  return { sort() { return this; }, populate() { return this; }, async lean() { return value; } };
}

function makeClient(overrides = {}) {
  return {
    numero: "5215512345678", nombre: "", pedidos: [], estadoPedido: "sin_pedido",
    paso: "inicio", productoPendiente: null, pedidoOrigen: "whatsapp",
    async save() { this.saved = true; }, ...overrides,
  };
}

function setup(cliente, products = []) {
  const sends = [];
  const context = loadWithMocks("controllers/storeController.js", {
    "models/Cliente.js": { findOneAndUpdate: async () => cliente },
    "models/Producto.js": { find: () => queryResult(products) },
    "models/Combo.js": { find: () => queryResult([]) },
    "services/catalogTenantService.js": {
      getLegacyCatalogTenant: async () => ({ _id: "tenant-legacy" }),
    },
    "services/whatsappService.js": {
      sendText: async (...args) => sends.push(["text", ...args]),
      sendButtons: async (...args) => sends.push(["buttons", ...args]),
    },
  });
  return { ...context, sends };
}

async function invoke(controller, body) {
  const res = responseRecorder();
  let forwarded;
  await controller({ body }, res, error => { forwarded = error; });
  if (forwarded) throw forwarded;
  return res;
}

test("rechaza teléfono vacío", async () => {
  const context = setup(makeClient());
  const res = await invoke(context.loaded.createStoreOrder, { numero: "", items: [{ id: "p0" }] });
  assert.equal(res.statusCode, 400);
  context.restore();
});

test("rechaza carrito compuesto solo por productos inexistentes", async () => {
  const context = setup(makeClient());
  const res = await invoke(context.loaded.createStoreOrder, { numero: "5512345678", items: [{ id: "no-existe", cantidad: 1 }] });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /productos v.+lidos/i);
  context.restore();
});

test("usa el precio del servidor e ignora precio manipulado del frontend", async () => {
  const cliente = makeClient();
  const context = setup(cliente);
  const res = await invoke(context.loaded.createStoreOrder, {
    numero: "5512345678", nombre: "Ana",
    items: [{ id: "p0", cantidad: 2, price: 1, precio: 1 }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 360);
  assert.equal(cliente.pedidos[0].precio, 180);
  assert.equal(cliente.pedidoOrigen, "tienda");
  assert.equal(context.sends.length, 2);
  context.restore();
});

test("rechaza reemplazar un pedido ya confirmado", async () => {
  const cliente = makeClient({ estadoPedido: "confirmado", pedidos: [{ productId: "p0" }] });
  const context = setup(cliente);
  const res = await invoke(context.loaded.createStoreOrder, { numero: "5512345678", items: [{ id: "p0" }] });
  assert.equal(res.statusCode, 409);
  assert.equal(cliente.pedidos.length, 1);
  assert.equal(context.sends.length, 0);
  context.restore();
});
