const Tenant = require("../models/Tenant");
const Branch = require("../models/Branch");

async function resolveStorefront(storefrontKey) {
  const key = String(storefrontKey || "").trim().toLowerCase();
  if (!key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) return null;
  return Tenant.findOne({
    storefrontKey: key,
    status: { $in: ["active", "onboarding"] },
  }).lean();
}

async function resolveStorefrontBranch(tenantId) {
  return Branch.findOne({ tenantId, active: { $ne: false } })
    .sort({ createdAt: 1 })
    .lean();
}

module.exports = { resolveStorefront, resolveStorefrontBranch };
