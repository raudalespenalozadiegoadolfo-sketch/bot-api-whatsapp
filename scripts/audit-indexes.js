#!/usr/bin/env node
if (process.argv.includes("--apply")) {
  console.error("ERROR: --apply no está habilitado. Esta herramienta es exclusivamente de lectura.");
  process.exitCode = 2;
} else {
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const { buildIndexMigrationPlan } = require("../services/indexMigrationService");
  const models = [
    require("../models/Cliente"), require("../models/Categoria"),
    require("../models/Producto"), require("../models/Combo"),
    require("../models/Cupon"), require("../models/Tenant"),
    require("../models/Branch"), require("../models/WhatsAppChannel"),
    require("../models/TenantMembership"), require("../models/Order"),
    require("../models/ProcessedMessage"),
  ];

  async function main() {
    await mongoose.connect(env.MONGO_URI, { autoIndex: false });
    try {
      const plan = await buildIndexMigrationPlan(models);
      console.log(JSON.stringify(plan, null, 2));
      if (plan.status === "BLOCKED") process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  }

  main().catch(error => {
    console.error("No fue posible auditar los índices:", error.message);
    process.exitCode = 1;
  });
}
