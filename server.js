require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const {
  syncLegacyCategories,
} = require(
  "./services/categorySyncService"
);

const {
  syncLegacyProducts,
} = require(
  "./services/productSyncService"
);

const adminComboRoutes = require(
  "./routes/adminComboRoutes"
);

const session = require("express-session");

const {
  MongoStore,
} = require("connect-mongo");

const env = require("./config/env");

/* =========================
   RUTAS DE CATEGORÍAS
========================= */

const adminCategoryRoutes = require(
  "./routes/adminCategoryRoutes"
);

/* =========================
   RUTAS DE COMBOS
========================= */



/* =========================
   RUTAS EXISTENTES
========================= */

const webhookRoutes = require(
  "./routes/webhookRoutes"
);

const storeRoutes = require(
  "./routes/storeRoutes"
);

const panelRoutes = require(
  "./routes/panelRoutes"
);

/* =========================
   RUTAS ADMINISTRATIVAS
========================= */

const authRoutes = require(
  "./routes/authRoutes"
);

const adminProductRoutes = require(
  "./routes/adminProductRoutes"
);

/* =========================
   SEGURIDAD ADMINISTRATIVA
========================= */

const {
  requireAdmin,
  requireLoginPage,
} = require(
  "./middleware/requireAdmin"
);

const {
  createInitialAdmin,
} = require(
  "./controllers/authController"
);

const app = express();

const isProduction =
  process.env.NODE_ENV ===
  "production";

/*
 * Render funciona detrás de un proxy.
 * Esto permite utilizar cookies seguras HTTPS
 * correctamente en producción.
 */
if (isProduction) {
  app.set("trust proxy", 1);
}

/* =========================
   VALIDAR CONFIGURACIÓN
========================= */

if (
  isProduction &&
  !process.env.SESSION_SECRET
) {
  throw new Error(
    "Falta la variable SESSION_SECRET en Render."
  );
}

const sessionSecret =
  process.env.SESSION_SECRET ||
  "desarrollo-local-cambiar-esta-clave";

/* =========================
   SESIONES ADMINISTRATIVAS
========================= */

app.use(
  session({
    name: "marisco_admin",

    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    rolling: true,

    store: MongoStore.create({
      mongoUrl: env.MONGO_URI,

      collectionName:
        "admin_sessions",

      ttl: 60 * 60 * 12,

      autoRemove:
        "native",
    }),

    cookie: {
      httpOnly: true,

      secure: isProduction,

      sameSite: "lax",

      maxAge:
        1000 *
        60 *
        60 *
        12,
    },
  })
);

/* =========================
   JSON + FIRMA DEL WEBHOOK
========================= */

app.use(
  express.json({
    limit: "10mb",

    verify: (
      req,
      _res,
      buffer
    ) => {
      req.rawBody = buffer;
    },
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "2mb",
  })
);

/* =========================
   PÁGINAS ADMINISTRATIVAS
========================= */

/*
 * Entrada principal del administrador.
 */
app.get(
  "/admin",
  (req, res) => {
    if (req.session?.usuario) {
      return res.redirect(
        "/admin/productos"
      );
    }

    return res.redirect(
      "/admin/login"
    );
  }
);

/*
 * Página de inicio de sesión.
 */
app.get(
  "/admin/login",
  (req, res) => {
    if (req.session?.usuario) {
      return res.redirect(
        "/admin/productos"
      );
    }

    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-login.html"
      )
    );
  }
);

/*
 * Página administrativa de productos.
 */
app.get(
  "/admin/productos",
  requireLoginPage,
  (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-productos.html"
      )
    );
  }
);

/*
 * Página administrativa de combos.
 */
app.get(
  "/admin/combos",
  requireLoginPage,
  (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-combos.html"
      )
    );
  }
);

/*
 * Evita que alguien abra directamente
 * el HTML de productos sin iniciar sesión.
 */
app.get(
  "/admin-productos.html",
  requireLoginPage,
  (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-productos.html"
      )
    );
  }
);

/*
 * Evita que alguien abra directamente
 * el HTML de combos sin iniciar sesión.
 */
app.get(
  "/admin-combos.html",
  requireLoginPage,
  (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-combos.html"
      )
    );
  }
);

/* =========================
   ARCHIVOS PÚBLICOS
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    ),
    {
      index: false,

      maxAge: isProduction
        ? "1h"
        : 0,
    }
  )
);

/* =========================
   API DE AUTENTICACIÓN
========================= */

app.use(
  "/api/auth",
  authRoutes
);

/* =========================
   API ADMINISTRATIVA
========================= */

/*
 * Productos.
 */
app.use(
  "/api/admin/productos",
  requireAdmin,
  adminProductRoutes
);

/*
 * Categorías.
 */
app.use(
  "/api/admin/categorias",
  requireAdmin,
  adminCategoryRoutes
);

/*
 * Combos.
 */
app.use(
  "/api/admin/combos",
  requireAdmin,
  adminComboRoutes
);

/* =========================
   RUTAS EXISTENTES
========================= */

app.use(webhookRoutes);

app.use(storeRoutes);

app.use(panelRoutes);

/* =========================
   INFORMACIÓN DE SESIÓN
========================= */

app.get(
  "/api/admin/session",
  requireAdmin,
  (req, res) => {
    return res.json({
      ok: true,

      usuario:
        req.session.usuario,
    });
  }
);

/* =========================
   RUTA DE SALUD
========================= */

app.get(
  "/health",
  (_req, res) => {
    return res.json({
      ok: true,

      service:
        "Marisco Alegre PRO",

      database:
        mongoose.connection
          .readyState === 1
          ? "connected"
          : "disconnected",

      environment:
        process.env.NODE_ENV ||
        "development",

      timestamp:
        new Date().toISOString(),
    });
  }
);

/* =========================
   RUTA NO ENCONTRADA
========================= */

app.use(
  (req, res) => {
    return res
      .status(404)
      .json({
        ok: false,

        error:
          "Ruta no encontrada",

        path:
          req.originalUrl,
      });
  }
);

/* =========================
   MANEJO DE ERRORES
========================= */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    console.error(
      "❌ Error del servidor:",
      error.response?.data ||
        error.stack ||
        error.message ||
        error
    );

    if (
      res.headersSent
    ) {
      return;
    }

    return res
      .status(
        error.status || 500
      )
      .json({
        ok: false,

        error:
          "Error interno",

        detalle:
          isProduction
            ? undefined
            : error.message,
      });
  }
);

/* =========================
   INICIAR SERVIDOR
========================= */

async function startServer() {
  try {
    await mongoose.connect(
      env.MONGO_URI
    );

    console.log(
      "✅ MongoDB conectado correctamente"
    );

    /*
     * Crear el administrador inicial
     * si todavía no existe.
     */
    await createInitialAdmin();

    /*
     * Sincronizar categorías
     * del menú actual.
     */
    await syncLegacyCategories();

    await syncLegacyProducts();

    app.listen(
      env.PORT,
      () => {
        console.log(
          `✅ Marisco Alegre PRO listo en el puerto ${env.PORT}`
        );

        console.log(
          `🔐 Administrador: http://localhost:${env.PORT}/admin/login`
        );

        console.log(
          `🍔 Combos: http://localhost:${env.PORT}/admin/combos`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ No fue posible iniciar el servidor:",
      error.stack ||
        error.message ||
        error
    );

    process.exitCode = 1;
  }
}

startServer();