const { createInitialAdmin } = require("../controllers/authController");
const { syncLegacyCategories } = require("./categorySyncService");
const { syncLegacyProducts } = require("./productSyncService");
const { backfillLegacyCatalogTenant } = require("./catalogBackfillService");
const { backfillLegacyCustomers } = require("./customerBackfillService");
const {
  ensureLegacyBranch,
  ensureLegacyMembership,
  ensureLegacyTenant,
  ensureLegacyWhatsAppChannel,
} = require("./legacyTenantService");

function shouldRunLegacyStartupBootstrap(value) {
  return value === "true";
}

async function runLegacyStartupBootstrap({
  createAdmin = createInitialAdmin,
  syncCategories = syncLegacyCategories,
  syncProducts = syncLegacyProducts,
  backfillCatalog = backfillLegacyCatalogTenant,
  backfillCustomers = backfillLegacyCustomers,
  ensureBranch = ensureLegacyBranch,
  ensureMembership = ensureLegacyMembership,
  ensureTenant = ensureLegacyTenant,
  ensureWhatsAppChannel = ensureLegacyWhatsAppChannel,
  phoneNumberId = "",
  whatsappBusinessAccountId = "",
  displayPhoneNumber = "",
} = {}) {
  const tenant = await ensureTenant();
  const branch = await ensureBranch(tenant);
  const admin = await createAdmin();
  await ensureMembership(admin, tenant);
  await ensureWhatsAppChannel(tenant, branch, {
    phoneNumberId,
    whatsappBusinessAccountId,
    displayPhoneNumber,
  });
  await backfillCatalog(tenant);
  await backfillCustomers(tenant);
  await syncCategories(tenant);
  await syncProducts(tenant);
}

module.exports = {
  runLegacyStartupBootstrap,
  shouldRunLegacyStartupBootstrap,
};