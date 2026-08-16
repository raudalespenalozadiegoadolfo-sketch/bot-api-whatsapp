#!/usr/bin/env node

/**
 * FASE 1.6.1 — Backfill Legacy Orders CLI
 *
 * Uso:
 *
 * DRY-RUN:
 *   npm run migrate:legacy-orders
 *
 * DRY-RUN con batch personalizado:
 *   npm run migrate:legacy-orders -- --batch-size=50
 *
 * APPLY:
 *   npm run migrate:legacy-orders -- --apply --confirm=MIGRATE_LEGACY_ORDERS
 *
 * Principios:
 * - DRY-RUN por defecto.
 * - APPLY requiere confirmación explícita exacta.
 * - Una confirmación inválida falla antes de cargar configuración/modelos.
 * - autoIndex deshabilitado.
 * - Siempre desconecta MongoDB cuando hubo conexión.
 */

const REQUIRED_CONFIRMATION = "MIGRATE_LEGACY_ORDERS";


// ============================================================================
// PARSEO DE ARGUMENTOS
// ============================================================================

const args = process.argv.slice(2);

const apply = args.includes("--apply");

const confirmArgument = args.find((arg) =>
  arg.startsWith("--confirm=")
);

const batchSizeArgument = args.find((arg) =>
  arg.startsWith("--batch-size=")
);

const confirmation =
  confirmArgument?.slice("--confirm=".length) || "";


// ============================================================================
// VALIDACIÓN TEMPRANA DE APPLY
// ============================================================================

/*
 * Esta validación ocurre antes de cargar:
 *
 * - config/env
 * - mongoose
 * - Cliente
 * - Order
 *
 * Por lo tanto, una confirmación inválida no llega a preparar
 * ninguna conexión con MongoDB.
 */
if (
  apply &&
  confirmation !== REQUIRED_CONFIRMATION
) {
  console.error(
    [
      `❌ Confirmación requerida: --confirm=${REQUIRED_CONFIRMATION}`,
      "",
      "Uso:",
      `  npm run migrate:legacy-orders -- --apply --confirm=${REQUIRED_CONFIRMATION}`,
    ].join("\n")
  );

  process.exit(2);
}


// ============================================================================
// CARGAR DEPENDENCIAS DESPUÉS DE VALIDAR APPLY
// ============================================================================

const mongoose = require("mongoose");

const env = require("../config/env");

const Cliente = require("../models/Cliente");
const Order = require("../models/Order");

const {
  backfillLegacyOrders,
  normalizeBatchSize,
} = require(
  "../services/legacyOrderBackfillService"
);


// ============================================================================
// VALIDAR BATCH SIZE
// ============================================================================

let batchSize;

try {
  batchSize = normalizeBatchSize(
    batchSizeArgument?.slice(
      "--batch-size=".length
    )
  );
} catch (error) {
  console.error(
    `❌ Error de configuración: ${error.message}`
  );

  process.exit(2);
}


// ============================================================================
// MAIN
// ============================================================================

async function main() {
  let connected = false;

  try {
    await mongoose.connect(
      env.MONGO_URI,
      {
        /*
         * Esta herramienta nunca debe crear índices
         * automáticamente al conectarse.
         */
        autoIndex: false,
      }
    );

    connected = true;


    console.log("");

    console.log(
      apply
        ? "🔄 Ejecutando MIGRACIÓN (APPLY)..."
        : "🔍 Ejecutando ANÁLISIS (DRY-RUN)..."
    );

    console.log("");


    const result =
      await backfillLegacyOrders({
        Cliente,
        Order,
        apply,
        confirmation,
        batchSize,
      });


    console.log("");

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log(
      "📊 RESULTADO DEL BACKFILL"
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log(
      JSON.stringify(result, null, 2)
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log("");


    /*
     * Un BLOCKED no elimina ni modifica el registro legacy.
     *
     * Se devuelve exit code 1 para obligar a revisar manualmente
     * cualquier registro no migrable o error.
     */
    if (
      result.blocked > 0 ||
      result.errors > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    if (connected) {
      await mongoose.disconnect();
    }
  }
}


// ============================================================================
// EJECUCIÓN
// ============================================================================

main().catch((error) => {
  console.error(
    "❌ Error fatal en el backfill:",
    error?.message || error
  );

  /*
   * No imprimimos stack completo de forma predeterminada para
   * reducir exposición accidental de información de entorno.
   */
  process.exitCode = 1;
});