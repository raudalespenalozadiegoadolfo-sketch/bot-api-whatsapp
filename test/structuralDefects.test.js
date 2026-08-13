const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Cupon = require("../models/Cupon");
const Producto = require("../models/Producto");
const Combo = require("../models/Combo");
const tenantId = new mongoose.Types.ObjectId();

test("Cupon expone el modelo y conserva el contrato del módulo administrativo", () => {
  assert.equal(typeof Cupon, "function");

  const coupon = new Cupon({
    tenantId,
    code: " verano20 ",
    description: "Promoción de verano",
    type: "percent",
    value: 20,
    minimumPurchase: 200,
    maxDiscount: 80,
    startsAt: new Date("2026-06-01"),
    expiresAt: new Date("2026-08-31"),
    usageLimit: 100,
    perCustomerLimit: 1,
  });

  assert.equal(coupon.validateSync(), undefined);
  assert.equal(coupon.code, "VERANO20");
  assert.equal(coupon.active, true);
  assert.equal(coupon.timesUsed, 0);
  assert.deepEqual(coupon.customerUsage, []);
  assert.equal(coupon.order, 0);
  assert.ok(Cupon.schema.indexes().some(([keys, options]) =>
    keys.tenantId === 1 && keys.code === 1 && options.unique
  ));
});

test("Cupon rechaza valores incompatibles con el controlador actual", () => {
  const invalidPercent = new Cupon({ tenantId, code: "MAL", type: "percent", value: 101 });
  assert.ok(invalidPercent.validateSync().errors.value);

  const invalidLimits = new Cupon({
    tenantId, code: "LIMITES", type: "fixed", value: 50,
    usageLimit: 1.5, perCustomerLimit: 0,
  });
  const errors = invalidLimits.validateSync().errors;
  assert.ok(errors.usageLimit);
  assert.ok(errors.perCustomerLimit);

  const invalidDates = new Cupon({
    tenantId, code: "FECHAS", type: "fixed", value: 50,
    startsAt: new Date("2026-08-31"), expiresAt: new Date("2026-06-01"),
  });
  assert.ok(invalidDates.validateSync().errors.expiresAt);
});

test("Producto persiste legacyId y source usados por productSyncService", () => {
  const product = new Producto({
    tenantId, legacyId: "p0", source: "legacy",
    name: "Camarones", category: "Mariscos", price: 180,
  });
  const plain = product.toObject();
  assert.equal(plain.legacyId, "p0");
  assert.equal(plain.source, "legacy");
  assert.equal(Producto.schema.path("legacyId").options.unique, undefined);

  const administrative = new Producto({ tenantId, name: "Nuevo", category: "Especiales", price: 100 });
  assert.equal(administrative.source, "admin");
});

test("Combo persiste excludedProductIds como referencias a Producto", () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const combo = new Combo({
    tenantId, name: "Combo configurable", comboPrice: 250,
    items: [{
      mode: "category", category: "Bebidas", cantidad: 1,
      excludedProductIds: [first, second],
    }],
  });
  assert.deepEqual(
    combo.items[0].excludedProductIds.map(String),
    [String(first), String(second)]
  );
  const path = Combo.schema.path("items").schema.path("excludedProductIds");
  assert.equal(path.caster.options.ref, "Producto");
});
