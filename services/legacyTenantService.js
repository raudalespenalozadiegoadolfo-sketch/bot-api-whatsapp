const Tenant = require("../models/Tenant");
const Branch = require("../models/Branch");
const WhatsAppChannel = require("../models/WhatsAppChannel");

const LEGACY_TENANT = Object.freeze({
  name: "Marisco Alegre",
  slug: "marisco-alegre",
  status: "active",
  timezone: "America/Mexico_City",
  currency: "MXN",
});

const LEGACY_BRANCH = Object.freeze({
  name: "Principal",
  slug: "principal",
  active: true,
});

async function ensureLegacyTenant() {
  return Tenant.findOneAndUpdate(
    { slug: LEGACY_TENANT.slug },
    { $setOnInsert: LEGACY_TENANT },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function ensureLegacyBranch(tenant) {
  return Branch.findOneAndUpdate(
    {
      tenantId: tenant._id,
      slug: LEGACY_BRANCH.slug,
    },
    {
      $setOnInsert: {
        ...LEGACY_BRANCH,
        tenantId: tenant._id,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function ensureLegacyWhatsAppChannel(
  tenant,
  branch,
  options = {}
) {
  const phoneNumberId = String(
    options.phoneNumberId || ""
  ).trim();

  if (!phoneNumberId) return null;

  return WhatsAppChannel.findOneAndUpdate(
    {
      provider: "meta",
      phoneNumberId,
    },
    {
      $setOnInsert: {
        tenantId: tenant._id,
        branchId: branch._id,
        provider: "meta",
        phoneNumberId,
        whatsappBusinessAccountId: String(
          options.whatsappBusinessAccountId || ""
        ).trim(),
        displayPhoneNumber: String(
          options.displayPhoneNumber || ""
        ).trim(),
        active: true,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function ensureLegacyBusiness(options = {}) {
  const tenant = await ensureLegacyTenant();
  const branch = await ensureLegacyBranch(tenant);
  const whatsappChannel =
    await ensureLegacyWhatsAppChannel(
      tenant,
      branch,
      options
    );

  return { tenant, branch, whatsappChannel };
}

module.exports = {
  LEGACY_BRANCH,
  LEGACY_TENANT,
  ensureLegacyBranch,
  ensureLegacyBusiness,
  ensureLegacyTenant,
  ensureLegacyWhatsAppChannel,
};
