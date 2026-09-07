require("dotenv").config();

const mongoose = require("mongoose");
const env = require("./config/env");
const { createApp } = require("./app");
const {
  runLegacyStartupBootstrap,
  shouldRunLegacyStartupBootstrap,
} = require("./services/legacyStartupBootstrapService");

async function startServer() {
  try {
    const app = createApp();

    await mongoose.connect(env.MONGO_URI);
    console.log("✅ MongoDB conectado correctamente");

    if (shouldRunLegacyStartupBootstrap(process.env.LEGACY_STARTUP_BOOTSTRAP)) {
      await runLegacyStartupBootstrap({
        phoneNumberId: env.PHONE_NUMBER_ID,
        whatsappBusinessAccountId:
          env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        displayPhoneNumber:
          env.WHATSAPP_DISPLAY_PHONE_NUMBER,
      });
    }

    app.listen(env.PORT, () => {
      console.log(`✅ Marisco Alegre PRO listo en el puerto ${env.PORT}`);
      console.log(`🔐 Administrador: http://localhost:${env.PORT}/admin/login`);
      console.log(`🍽️ Productos: http://localhost:${env.PORT}/admin/productos`);
      console.log(`🍔 Combos: http://localhost:${env.PORT}/admin/combos`);
      console.log(`🎟️ Cupones: http://localhost:${env.PORT}/admin/cupones`);
      console.log(`🛒 Tienda: http://localhost:${env.PORT}/tienda`);
    });
  } catch (error) {
    console.error("❌ No fue posible iniciar el servidor:", error.stack || error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
