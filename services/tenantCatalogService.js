const Categoria = require("../models/Categoria");
const Producto = require("../models/Producto");

function serializeProduct(product) {
  return {
    id: String(product._id),
    name: product.name,
    category: product.category,
    price: Number(product.price),
    type: product.type === "drink" ? "drink" : "food",
    description: product.description || "",
    imageUrl: product.imageUrl || "",
    aliases: Array.isArray(product.aliases) ? product.aliases : [],
  };
}

function createTenantCatalog(tenantId) {
  if (!tenantId) throw new Error("Se requiere tenantId para consultar el catálogo.");
  return {
    async getCategories(type) {
      const productCategories = await Producto.distinct("category", {
        tenantId, type, active: { $ne: false },
      });
      return productCategories;
    },
    async getProducts() {
      return (await Producto.find({ tenantId, active: { $ne: false } }).sort({ category: 1, order: 1, name: 1 }).lean()).map(serializeProduct);
    },
    async getProductsByCategory(type, category) {
      return (await Producto.find({ tenantId, type, category, active: { $ne: false } }).sort({ order: 1, name: 1 }).lean()).map(serializeProduct);
    },
    async findProductById(id) {
      const product = await Producto.findOne({ _id: id, tenantId, active: { $ne: false } }).lean();
      return product ? serializeProduct(product) : null;
    },
    async getActiveCategories() {
      return Categoria.find({ tenantId, active: { $ne: false } }).sort({ order: 1, name: 1 }).lean();
    },
  };
}

module.exports = { createTenantCatalog, serializeProduct };
