const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addProduct,
  totalOf,
  clearDraftOrder,
  emptyOrder,
} = require("../services/carritoService");

function client() {
  return {
    pedidos: [],
    estadoPedido: "sin_pedido",
    paso: "inicio",
    productoPendiente: null,
  };
}

test("agrega productos, acumula cantidades y calcula el total", () => {
  const cliente = client();
  const product = { id: "p0", name: "Camarones", price: 180 };
  addProduct(cliente, product, 2);
  addProduct(cliente, product, 3);
  assert.deepEqual(cliente.pedidos, [{
    productId: "p0", nombre: "Camarones", precio: 180, cantidad: 5,
  }]);
  assert.equal(totalOf(cliente), 900);
  assert.equal(cliente.estadoPedido, "armando");
});

test("vacía por completo el carrito y restablece su estado", () => {
  const cliente = client();
  addProduct(cliente, { id: "p1", name: "Agua", price: 35 }, 2);
  emptyOrder(cliente);
  assert.deepEqual(cliente.pedidos, []);
  assert.equal(cliente.estadoPedido, "sin_pedido");
  assert.equal(cliente.paso, "inicio");
});

test("clearDraftOrder no altera un pedido que ya está confirmado", () => {
  const cliente = client();
  cliente.pedidos = [{ productId: "p0", precio: 180, cantidad: 1 }];
  cliente.estadoPedido = "confirmado";
  assert.equal(clearDraftOrder(cliente), false);
  assert.equal(cliente.pedidos.length, 1);
});
