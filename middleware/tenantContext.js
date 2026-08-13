const Usuario = require("../models/Usuario");
const Tenant = require("../models/Tenant");
const TenantMembership = require("../models/TenantMembership");

const ALLOWED_TENANT_STATUSES = new Set([
  "active",
  "onboarding",
]);

function setTrustedTenantContext(
  req,
  context
) {
  if (!context?.tenantId) {
    throw new Error(
      "Se requiere un contexto de tenant confiable."
    );
  }

  req.tenantId = context.tenantId;
  req.tenant = context.tenant || null;
  req.branchId = context.branchId || null;
  req.whatsappChannel =
    context.channel || null;

  return req;
}

async function resolveTenantContextFromSession(req) {
  const sessionUserId = req.session?.usuario?.id;
  const sessionContext = req.session?.tenantContext;

  if (!sessionUserId || !sessionContext?.tenantId || !sessionContext?.membershipId) {
    return { resolved: false, reason: "authentication_required" };
  }

  const [user, membership, tenant] = await Promise.all([
    Usuario.findOne({ _id: sessionUserId, activo: true }).lean(),
    TenantMembership.findOne({
      _id: sessionContext.membershipId,
      userId: sessionUserId,
      tenantId: sessionContext.tenantId,
      active: true,
    }).lean(),
    Tenant.findById(sessionContext.tenantId).lean(),
  ]);

  if (!user) return { resolved: false, reason: "user_inactive" };
  if (!membership) return { resolved: false, reason: "membership_invalid" };
  if (!tenant) return { resolved: false, reason: "tenant_not_found" };
  if (!ALLOWED_TENANT_STATUSES.has(tenant.status)) {
    return { resolved: false, reason: `tenant_${tenant.status}` };
  }

  return {
    resolved: true,
    tenantId: tenant._id,
    tenant,
    membership,
    user,
  };
}

async function requireTenantContext(req, res, next) {
  try {
    const context = await resolveTenantContextFromSession(req);

    if (!context.resolved) {
      const unauthenticated = context.reason === "authentication_required";
      return res.status(unauthenticated ? 401 : 403).json({
        ok: false,
        code: context.reason,
        error: unauthenticated
          ? "Debes iniciar sesión."
          : "No tienes acceso a este negocio.",
      });
    }

    setTrustedTenantContext(req, context);
    req.tenantMembership = context.membership;
    req.authenticatedUser = context.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function tenantContextFromTrustedResolver(
  resolver
) {
  if (typeof resolver !== "function") {
    throw new TypeError(
      "El resolvedor de tenant debe ser una función."
    );
  }

  return async function tenantContext(
    req,
    res,
    next
  ) {
    try {
      const context = await resolver(req);

      if (!context?.tenantId) {
        return res.status(404).json({
          ok: false,
          error:
            "No fue posible resolver el negocio.",
        });
      }

      setTrustedTenantContext(req, context);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  ALLOWED_TENANT_STATUSES,
  requireTenantContext,
  resolveTenantContextFromSession,
  setTrustedTenantContext,
  tenantContextFromTrustedResolver,
};
