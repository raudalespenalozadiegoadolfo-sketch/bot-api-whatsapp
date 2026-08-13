require("dotenv").config();

const mongoose = require("mongoose");
const env = require("./config/env");
const { createApp } = require("./app");
const { createInitialAdmin } = require("./controllers/authController");
const { syncLegacyCategories } = require("./services/categorySyncService");
const { syncLegacyProducts } = require("./services/productSyncService");
const { ensureLegacyBusiness } = require("./services/legacyTenantService");

async function startServer() {
  try {
    const app = createApp();

    await mongoose.connect(env.MONGO_URI);
    console.log("✅ MongoDB conectado correctamente");

    await ensureLegacyBusiness({
      phoneNumberId: env.PHONE_NUMBER_ID,
      whatsappBusinessAccountId:
        env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      displayPhoneNumber:
        env.WHATSAPP_DISPLAY_PHONE_NUMBER,
    });

    await createInitialAdmin();
    await syncLegacyCategories();
    await syncLegacyProducts();

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
