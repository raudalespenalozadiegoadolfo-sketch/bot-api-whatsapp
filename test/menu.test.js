const test = require("node:test");
const assert = require("node:assert/strict");
const menu = require("../services/menuService");
const matcher = require("../services/productMatcherService");

test("catálogo legado conserva IDs, categorías y precios conocidos", () => {
  assert.equal(menu.products.length, 42);
  assert.equal(menu.findProductById("p0").price, 180);
  assert.ok(menu.getCategories("food").includes("Camarones"));
  assert.ok(menu.getProductsByCategory("drink", "Cervezas").length > 0);
});

test("matcher reconoce producto y cantidad escrita", () => {
  const detected = matcher.detectProducts("quiero 2 camarones a la diabla");
  assert.equal(detected[0].product.id, "p0");
  assert.equal(detected[0].quantity, 2);
});
