const bcrypt = require("bcryptjs");

const Usuario =
  require("../models/Usuario");

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
    return;
  }

  const passwordHash =
    await bcrypt.hash(
      password,
      12
    );

  await Usuario.create({
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

    user.ultimoAcceso =
      new Date();

    await user.save();

    req.session.usuario = {
      id: String(user._id),
      nombre: user.nombre,
      usuario: user.usuario,
      rol: user.rol,
    };

    return res.json({
      ok: true,
      usuario:
        req.session.usuario,
    });
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
  if (!req.session?.usuario) {
    return res.status(401).json({
      ok: false,
      error:
        "No hay una sesión activa.",
    });
  }

  return res.json({
    ok: true,
    usuario:
      req.session.usuario,
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