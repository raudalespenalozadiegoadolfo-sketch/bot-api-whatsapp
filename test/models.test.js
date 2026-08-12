const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const Categoria = require("../models/Categoria");
const Combo = require("../models/Combo");
const ProcessedMessage = require("../models/ProcessedMessage");

test("Cliente aplica estados iniciales y valida enums", async () => {
  const cliente = new Cliente({ numero: "5215512345678" });
  assert.equal(cliente.paso, "inicio");
  assert.equal(cliente.estadoPedido, "sin_pedido");
  assert.deepEqual(cliente.pedidos, []);
  cliente.estadoPedido = "estado_inexistente";
  assert.ok(cliente.validateSync().errors.estadoPedido);
});

test("Producto requiere nombre, categoría y precio no negativo", () => {
  const invalid = new Producto({ price: -1 });
  const errors = invalid.validateSync().errors;
  assert.ok(errors.name);
  assert.ok(errors.category);
  assert.ok(errors.price);
  const valid = new Producto({ name: "Agua", category: "Bebidas", price: 35 });
  assert.equal(valid.validateSync(), undefined);
});

test("Categoria exige normalizedName y su índice es único", () => {
  const invalid = new Categoria({ name: "Bebidas" });
  assert.ok(invalid.validateSync().errors.normalizedName);
  const indexes = Categoria.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.normalizedName === 1 && options.unique));
});

test("Combo valida cantidad y referencia Producto", () => {
  const combo = new Combo({
    name: "Combo", comboPrice: 100,
    items: [{ mode: "product", productId: new mongoose.Types.ObjectId(), cantidad: 21 }],
  });
  assert.ok(combo.validateSync().errors["items.0.cantidad"]);
  assert.equal(Combo.schema.path("items").schema.path("productId").options.ref, "Producto");
});

test("ProcessedMessage declara messageId único y TTL de siete días", () => {
  assert.equal(ProcessedMessage.schema.path("messageId").options.unique, true);
  assert.equal(ProcessedMessage.schema.path("createdAt").options.expires, "7d");
});
