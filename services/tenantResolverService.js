const WhatsAppChannel = require("../models/WhatsAppChannel");
const Tenant = require("../models/Tenant");

async function resolveTenantFromPhoneNumberId(
  phoneNumberId
) {
  const normalized = String(
    phoneNumberId || ""
  ).trim();

  if (!normalized) {
    return {
      resolved: false,
      reason: "missing_phone_number_id",
    };
  }

  const channel =
    await WhatsAppChannel.findOne({
      provider: "meta",
      phoneNumberId: normalized,
    }).lean();

  if (!channel) {
    return {
      resolved: false,
      reason: "channel_not_found",
    };
  }

  if (!channel.active) {
    return {
      resolved: false,
      reason: "channel_inactive",
      channelId: channel._id,
    };
  }

  const tenant = await Tenant.findById(channel.tenantId).lean();
  if (!tenant || !["active", "onboarding"].includes(tenant.status)) {
    return {
      resolved: false,
      reason: !tenant ? "tenant_not_found" : `tenant_${tenant.status}`,
      channelId: channel._id,
    };
  }

  return {
    resolved: true,
    tenantId: channel.tenantId,
    branchId: channel.branchId || null,
    channel,
    tenant,
  };
}

module.exports = {
  resolveTenantFromPhoneNumberId,
};
