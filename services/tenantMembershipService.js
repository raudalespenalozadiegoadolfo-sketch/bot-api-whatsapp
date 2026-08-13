const TenantMembership = require("../models/TenantMembership");

const ACCESSIBLE_TENANT_STATUSES = Object.freeze([
  "active",
  "onboarding",
]);

async function listActiveMembershipsForUser(userId) {
  if (!userId) return [];

  const memberships = await TenantMembership.find({
    userId,
    active: true,
  })
    .populate({
      path: "tenantId",
      match: {
        status: { $in: ACCESSIBLE_TENANT_STATUSES },
      },
      select: "name slug status",
    })
    .lean();

  return memberships.filter(membership => membership.tenantId);
}

async function selectMembershipForLogin(userId) {
  const memberships = await listActiveMembershipsForUser(userId);

  if (memberships.length === 0) {
    return {
      selected: false,
      reason: "no_active_membership",
      memberships: [],
    };
  }

  if (memberships.length > 1) {
    return {
      selected: false,
      reason: "tenant_selection_required",
      memberships,
    };
  }

  return {
    selected: true,
    membership: memberships[0],
  };
}

function toSessionTenantContext(membership) {
  return {
    tenantId: String(membership.tenantId._id),
    membershipId: String(membership._id),
    role: membership.role,
  };
}

module.exports = {
  ACCESSIBLE_TENANT_STATUSES,
  listActiveMembershipsForUser,
  selectMembershipForLogin,
  toSessionTenantContext,
};
