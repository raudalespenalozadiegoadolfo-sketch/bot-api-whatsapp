const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const Categoria = require("../models/Categoria");
const Combo = require("../models/Combo");
const ProcessedMessage = require("../models/ProcessedMessage");
const tenantId = new mongoose.Types.ObjectId();

test("Cliente aplica estados iniciales y valida enums", async () => {
  const cliente = new Cliente({ tenantId, numero: "5215512345678" });
  const branchId = new mongoose.Types.ObjectId();
  cliente.branchId = branchId;
  assert.equal(String(cliente.toObject().tenantId), String(tenantId));
  assert.equal(String(cliente.toObject().branchId), String(branchId));
  assert.equal(cliente.paso, "inicio");
  assert.equal(cliente.estadoPedido, "sin_pedido");
  assert.deepEqual(cliente.pedidos, []);
  assert.equal(new Cliente({ numero: "5215512345679" }).validateSync(), undefined);
  cliente.estadoPedido = "estado_inexistente";
  assert.ok(cliente.validateSync().errors.estadoPedido);
});

test("Producto requiere nombre, categoría y precio no negativo", () => {
  const invalid = new Producto({ price: -1 });
  const errors = invalid.validateSync().errors;
  assert.ok(errors.name);
  assert.ok(errors.category);
  assert.ok(errors.price);
  const valid = new Producto({ tenantId, name: "Agua", category: "Bebidas", price: 35 });
  assert.equal(String(valid.toObject().tenantId), String(tenantId));
  assert.equal(valid.validateSync(), undefined);
  assert.equal(new Producto({ name: "Legacy", category: "Bebidas", price: 35 }).validateSync(), undefined);
});

test("Categoria exige normalizedName y su índice es único", () => {
  const invalid = new Categoria({ tenantId, name: "Bebidas" });
  assert.ok(invalid.validateSync().errors.normalizedName);
  const indexes = Categoria.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.tenantId === 1 && keys.normalizedName === 1 && options.unique));
});

test("Combo valida cantidad y referencia Producto", () => {
  const combo = new Combo({
    tenantId, name: "Combo", comboPrice: 100,
    items: [{ mode: "product", productId: new mongoose.Types.ObjectId(), cantidad: 21 }],
  });
  assert.equal(String(combo.toObject().tenantId), String(tenantId));
  assert.ok(combo.validateSync().errors["items.0.cantidad"]);
  assert.equal(Combo.schema.path("items").schema.path("productId").options.ref, "Producto");
});

test("Combo y Cupon legacy siguen validando sin tenantId", () => {
  const combo = new Combo({ name: "Combo legacy", comboPrice: 100 });
  const coupon = new (require("../models/Cupon"))({ code: "LEGACY", type: "fixed", value: 10 });
  assert.equal(combo.validateSync(), undefined);
  assert.equal(coupon.validateSync(), undefined);
});

test("ProcessedMessage declara messageId único y TTL de siete días", () => {
  assert.equal(ProcessedMessage.schema.path("messageId").options.unique, true);
  assert.equal(ProcessedMessage.schema.path("createdAt").options.expires, "7d");
});
