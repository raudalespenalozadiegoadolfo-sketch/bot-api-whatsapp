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
  setTrustedTenantContext,
  tenantContextFromTrustedResolver,
};
