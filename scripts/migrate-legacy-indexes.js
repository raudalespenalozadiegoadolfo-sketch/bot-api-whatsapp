#!/usr/bin/env node
const apply = process.argv.includes("--apply");
const confirmationArgument = process.argv.find(argument => argument.startsWith("--confirm="));
const confirmation = confirmationArgument?.slice("--confirm=".length);

const {
  REQUIRED_CONFIRMATION,
  migrateApprovedIndexes,
} = require("../services/legacyIndexMigrationService");

if (apply && confirmation !== REQUIRED_CONFIRMATION) {
  console.error(`Confirmación requerida: --confirm=${REQUIRED_CONFIRMATION}`);
  process.exitCode = 2;
} else {
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const models = [
    require("../models/Cliente"),
    require("../models/Categoria"),
    require("../models/Cupon"),
  ];

  async function main() {
    await mongoose.connect(env.MONGO_URI, { autoIndex: false });
    try {
      const result = await migrateApprovedIndexes(models, { apply, confirmation });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "ERROR") process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  }

  main().catch(error => {
    console.error("No fue posible ejecutar la migración controlada:", error.message);
    process.exitCode = 1;
  });
}
