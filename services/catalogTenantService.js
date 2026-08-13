const Tenant = require("../models/Tenant");

const LEGACY_TENANT_SLUG = "marisco-alegre";
let legacyTenantPromise = null;

async function getLegacyCatalogTenant() {
  if (!legacyTenantPromise) {
    legacyTenantPromise = Tenant.findOne({
      slug: LEGACY_TENANT_SLUG,
      status: { $in: ["active", "onboarding"] },
    }).lean();
  }

  const tenant = await legacyTenantPromise;
  if (!tenant) {
    legacyTenantPromise = null;
    throw new Error("El tenant legacy del catálogo no está disponible.");
  }
  return tenant;
}

function resetLegacyCatalogTenantCache() {
  legacyTenantPromise = null;
}

module.exports = {
  getLegacyCatalogTenant,
  resetLegacyCatalogTenantCache,
};
