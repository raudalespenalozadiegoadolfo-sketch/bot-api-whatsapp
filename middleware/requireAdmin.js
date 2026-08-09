function requireAdmin(req, res, next) {
  if (!req.session?.usuario) {
    return res.status(401).json({
      ok: false,
      error: "Debes iniciar sesión.",
    });
  }

  if (
    req.session.usuario.rol !==
    "administrador"
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "No tienes permiso para realizar esta acción.",
    });
  }

  return next();
}

function requireLoginPage(
  req,
  res,
  next
) {
  if (!req.session?.usuario) {
    return res.redirect(
      "/admin/login"
    );
  }

  return next();
}

module.exports = {
  requireAdmin,
  requireLoginPage,
};