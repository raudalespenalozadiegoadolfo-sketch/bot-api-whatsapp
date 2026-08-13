const Tenant = require("../models/Tenant");

async function resolveStorefront(storefrontKey) {
  const key = String(storefrontKey || "").trim().toLowerCase();
  if (!key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) return null;
  return Tenant.findOne({
    storefrontKey: key,
    status: { $in: ["active", "onboarding"] },
  }).lean();
}

module.exports = { resolveStorefront };
