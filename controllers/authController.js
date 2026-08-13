const bcrypt = require("bcryptjs");

const Usuario =
  require("../models/Usuario");
const {
  selectMembershipForLogin,
  toSessionTenantContext,
} = require("../services/tenantMembershipService");

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function createInitialAdmin() {
  const username =
    normalizeUsername(
      process.env.ADMIN_USER
    );

  const password =
    String(
      process.env.ADMIN_PASSWORD ||
        ""
    );

  if (!username || !password) {
    console.warn(
      "⚠️ ADMIN_USER o ADMIN_PASSWORD no están configurados."
    );

    return;
  }

  const existing =
    await Usuario.findOne({
      usuario: username,
    });

  if (existing) {
    return existing;
  }

  const passwordHash =
    await bcrypt.hash(
      password,
      12
    );

  const created = await Usuario.create({
    nombre:
      "Administrador principal",

    usuario: username,

    passwordHash,

    rol: "administrador",

    activo: true,
  });

  console.log(
    "✅ Usuario administrador inicial creado."
  );

  return created;
}

async function login(req, res) {
  try {
    const usuario =
      normalizeUsername(
        req.body?.usuario
      );

    const password =
      String(
        req.body?.password || ""
      );

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        error:
          "Escribe usuario y contraseña.",
      });
    }

    const user =
      await Usuario.findOne({
        usuario,
        activo: true,
      });

    if (!user) {
      return res.status(401).json({
        ok: false,
        error:
          "Usuario o contraseña incorrectos.",
      });
    }

    const validPassword =
      await bcrypt.compare(
        password,
        user.passwordHash
      );

    if (!validPassword) {
      return res.status(401).json({
        ok: false,
        error:
          "Usuario o contraseña incorrectos.",
      });
    }

    const membershipSelection =
      await selectMembershipForLogin(user._id);

    if (!membershipSelection.selected) {
      if (
        membershipSelection.reason ===
        "tenant_selection_required"
      ) {
        return res.status(409).json({
          ok: false,
          code: "tenant_selection_required",
          error: "Selecciona el negocio al que deseas acceder.",
          tenants: membershipSelection.memberships.map(membership => ({
            id: String(membership.tenantId._id),
            name: membership.tenantId.name,
            slug: membership.tenantId.slug,
            role: membership.role,
          })),
        });
      }

      return res.status(403).json({
        ok: false,
        code: "tenant_access_denied",
        error: "No tienes acceso a un negocio activo.",
      });
    }

    user.ultimoAcceso =
      new Date();

    await user.save();

    const sessionUser = {
      id: String(user._id),
      nombre: user.nombre,
      usuario: user.usuario,
      rol: user.rol,
    };

    return req.session.regenerate(
      error => {
        if (error) {
          console.error(
            "Error regenerando sesión:",
            error
          );
          return res.status(500).json({
            ok: false,
            error: "No se pudo iniciar sesión.",
          });
        }

        req.session.usuario = sessionUser;
        req.session.tenantContext =
          toSessionTenantContext(
            membershipSelection.membership
          );

        return req.session.save(
          saveError => {
            if (saveError) {
              return res.status(500).json({
                ok: false,
                error: "No se pudo iniciar sesión.",
              });
            }

            return res.json({
              ok: true,
              usuario: sessionUser,
              tenant: {
                id: String(membershipSelection.membership.tenantId._id),
                name: membershipSelection.membership.tenantId.name,
                slug: membershipSelection.membership.tenantId.slug,
              },
              membership: {
                role: membershipSelection.membership.role,
              },
            });
          }
        );
      }
    );
  } catch (error) {
    console.error(
      "Error al iniciar sesión:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No se pudo iniciar sesión.",
    });
  }
}

function currentUser(req, res) {
  if (!req.session?.usuario || !req.tenantMembership) {
    return res.status(401).json({
      ok: false,
      error:
        "No hay una sesión activa.",
    });
  }

  return res.json({
    ok: true,
    authenticated: true,
    user: {
      id: String(req.authenticatedUser._id),
      name: req.authenticatedUser.nombre,
      username: req.authenticatedUser.usuario,
    },
    tenant: {
      id: String(req.tenant._id),
      name: req.tenant.name,
      slug: req.tenant.slug,
    },
    membership: {
      role: req.tenantMembership.role,
    },
  });
}

function logout(req, res) {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        ok: false,
        error:
          "No se pudo cerrar sesión.",
      });
    }

    res.clearCookie(
      "marisco_admin"
    );

    return res.json({
      ok: true,
    });
  });
}

module.exports = {
  createInitialAdmin,
  login,
  currentUser,
  logout,
};
