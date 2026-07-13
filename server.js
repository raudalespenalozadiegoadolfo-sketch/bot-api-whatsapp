require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const env = require("./config/env");

const webhookRoutes = require(
  "./routes/webhookRoutes"
);

const storeRoutes = require(
  "./routes/storeRoutes"
);

const panelRoutes = require(
  "./routes/panelRoutes"
);

const app = express();

/* =========================
   JSON + FIRMA DEL WEBHOOK
========================= */

app.use(
  express.json({
    limit: "10mb",

    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    },
  })
);

/* =========================
   ARCHIVOS PÚBLICOS
========================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   RUTAS
========================= */

app.use(webhookRoutes);
app.use(storeRoutes);
app.use(panelRoutes);

/* =========================
   RUTA DE SALUD
========================= */

app.get("/health", (_req, res) => {
  return res.json({
    ok: true,
    service: "Marisco Alegre PRO",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

/* =========================
   RUTA NO ENCONTRADA
========================= */

app.use((req, res) => {
  return res.status(404).json({
    error: "Ruta no encontrada",
    path: req.originalUrl,
  });
});

/* =========================
   MANEJO DE ERRORES
========================= */

app.use(
  (error, _req, res, _next) => {
    console.error(
      "❌ Error del servidor:",
      error.response?.data ||
        error.stack ||
        error.message ||
        error
    );

    return res.status(500).json({
      error: "Error interno",
      detalle:
        process.env.NODE_ENV ===
        "production"
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

    app.listen(env.PORT, () => {
      console.log(
        `✅ Marisco Alegre PRO listo en el puerto ${env.PORT}`
      );
    });
  } catch (error) {
    console.error(
      "❌ No fue posible iniciar el servidor:",
      error.message
    );

    process.exitCode = 1;
  }
}

startServer();