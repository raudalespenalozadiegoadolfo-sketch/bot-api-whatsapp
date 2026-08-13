const {
  requireTenantContext,
  resolveTenantContextFromSession,
  setTrustedTenantContext,
} = require("./tenantContext");

const TENANT_ROLE_LEVEL = Object.freeze({
  staff: 1,
  manager: 2,
  administrator: 3,
  owner: 4,
});

function requireTenantRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);

  return function tenantRole(req, res, next) {
    if (!req.tenantMembership) {
      return res.status(403).json({
        ok: false,
        error: "No existe un membership de tenant validado.",
      });
    }

    if (!allowed.has(req.tenantMembership.role)) {
      return res.status(403).json({
        ok: false,
        error: "No tienes permiso para realizar esta acción.",
      });
    }

    return next();
  };
}

const requireAdministrativeRole = requireTenantRole(
  "owner",
  "administrator"
);

function requireAdmin(req, res, next) {
  return requireTenantContext(req, res, error => {
    if (error) return next(error);
    return requireAdministrativeRole(req, res, next);
  });
}

function requireLoginPage(
  req,
  res,
  next
) {
  return resolveTenantContextFromSession(req)
    .then(context => {
      if (!context.resolved) return res.redirect("/admin/login");
      setTrustedTenantContext(req, context);
      req.tenantMembership = context.membership;
      req.authenticatedUser = context.user;
      return next();
    })
    .catch(next);
}

function requireAdminPage(
  req,
  res,
  next
) {
  return requireLoginPage(req, res, error => {
    if (error) return next(error);
    if (!["owner", "administrator"].includes(req.tenantMembership.role)) {
      return res.redirect("/admin/login");
    }
    return next();
  });
}

module.exports = {
  TENANT_ROLE_LEVEL,
  requireAdmin,
  requireLoginPage,
  requireAdminPage,
  requireTenantRole,
};
