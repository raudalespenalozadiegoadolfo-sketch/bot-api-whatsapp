const Cliente = require("../models/Cliente");

const CUSTOMER_WITHOUT_TENANT = {
  $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
};

async function backfillLegacyCustomers(tenant) {
  if (!tenant?._id) throw new Error("Se requiere el tenant legacy para el backfill de clientes.");
  return Cliente.updateMany(
    CUSTOMER_WITHOUT_TENANT,
    { $set: { tenantId: tenant._id } }
  );
}

module.exports = { CUSTOMER_WITHOUT_TENANT, backfillLegacyCustomers };
