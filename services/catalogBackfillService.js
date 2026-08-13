const Categoria = require("../models/Categoria");
const Producto = require("../models/Producto");
const Combo = require("../models/Combo");
const Cupon = require("../models/Cupon");

const WITHOUT_TENANT = {
  $or: [
    { tenantId: { $exists: false } },
    { tenantId: null },
  ],
};

async function backfillLegacyCatalogTenant(tenant) {
  if (!tenant?._id) throw new Error("Se requiere el tenant legacy para el backfill.");

  const models = { categories: Categoria, products: Producto, combos: Combo, coupons: Cupon };
  const results = {};
  for (const [name, Model] of Object.entries(models)) {
    results[name] = await Model.updateMany(
      WITHOUT_TENANT,
      { $set: { tenantId: tenant._id } }
    );
  }
  return results;
}

module.exports = { WITHOUT_TENANT, backfillLegacyCatalogTenant };
