const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks } = require("../test-support/moduleMocks");

test("findOrCreateCliente usa upsert y el número como identidad", async () => {
  let captured;
  const expected = { numero: "5215512345678" };
  const context = loadWithMocks("services/clienteService.js", {
    "models/Cliente.js": { findOneAndUpdate: async (...args) => { captured = args; return expected; } },
  });
  const result = await context.loaded.findOrCreateCliente(expected.numero);
  assert.equal(result, expected);
  assert.deepEqual(captured[0], { numero: expected.numero });
  assert.equal(captured[2].upsert, true);
  assert.equal(captured[2].new, true);
  context.restore();
});

test("resetDraft limpia únicamente el borrador actual", () => {
  const context = loadWithMocks("services/clienteService.js", {
    "models/Cliente.js": {},
  });
  const cliente = { pedidos: [1], productoPendiente: {}, paso: "esperando_cantidad", estadoPedido: "armando" };
  context.loaded.resetDraft(cliente);
  assert.deepEqual(cliente.pedidos, []);
  assert.equal(cliente.productoPendiente, null);
  assert.equal(cliente.estadoPedido, "sin_pedido");
  context.restore();
});
