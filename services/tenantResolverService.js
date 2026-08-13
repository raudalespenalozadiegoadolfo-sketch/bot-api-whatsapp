const WhatsAppChannel = require("../models/WhatsAppChannel");

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

  return {
    resolved: true,
    tenantId: channel.tenantId,
    branchId: channel.branchId || null,
    channel,
  };
}

module.exports = {
  resolveTenantFromPhoneNumberId,
};
