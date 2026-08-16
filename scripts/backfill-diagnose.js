#!/usr/bin/env node

/**
 * Diagnostico read-only de Cliente.historialPedidos.
 * Uso: node scripts/backfill-diagnose.js --customer-id=<ID> --tenant-id=<ID>
 */

const {
  RECORD_STATUS,
  TERMINAL_LEGACY_STATUSES,
  convertLegacyEntry,
} = require("../services/legacyOrderBackfillService");

function parseArguments(args) {
  if (args.includes("--apply")) {
    throw new Error("--apply no esta permitido: esta herramienta es exclusivamente read-only.");
  }

  const customerArgument = args.find(argument => argument.startsWith("--customer-id="));
  const tenantArgument = args.find(argument => argument.startsWith("--tenant-id="));
  const allowed = new Set([customerArgument, tenantArgument].filter(Boolean));
  const unknown = args.filter(argument => !allowed.has(argument));
  if (unknown.length) throw new Error(`Argumento no permitido: ${unknown[0]}`);

  const customerId = customerArgument?.slice("--customer-id=".length).trim();
  const tenantId = tenantArgument?.slice("--tenant-id=".length).trim();
  if (!customerId || !tenantId) {
    throw new Error("--customer-id y --tenant-id son obligatorios.");
  }
  return { customerId, tenantId };
}

function classifyEntry(customer, entry) {
  const terminalStatus = TERMINAL_LEGACY_STATUSES.includes(entry?.estadoFinal);
  const conversion = convertLegacyEntry(customer, entry);
  const migratable = terminalStatus && conversion.status === RECORD_STATUS.READY;
  return {
    classification: migratable ? "MIGRATABLE" : "NOT_MIGRATABLE",
    legacyStatus: entry?.estadoFinal ?? null,
    reason: migratable ? null : conversion.reason || "non_terminal_status",
    terminalStatus,
  };
}

async function runDiagnostic({ Cliente, customerId, tenantId, logger = console.log }) {
  const customer = await Cliente.findOne({ _id: customerId, tenantId })
    .select("_id tenantId branchId historialPedidos")
    .lean();
  if (!customer) throw new Error("Cliente no encontrado dentro del tenant indicado.");

  const entries = Array.isArray(customer.historialPedidos) ? customer.historialPedidos : [];
  const results = entries.map((entry, index) => ({
    index,
    ...classifyEntry(customer, entry),
    hasDate: Boolean(entry?.fecha),
    itemCount: Array.isArray(entry?.pedidos) ? entry.pedidos.length : 0,
  }));

  logger(JSON.stringify({
    event: "legacy_order_diagnostic",
    customerId: String(customer._id),
    tenantId: String(customer.tenantId),
    entryCount: results.length,
    results,
  }, null, 2));
  return results;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);

  // Carga tardia: --apply y argumentos invalidos fallan antes de preparar MongoDB.
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const Cliente = require("../models/Cliente");
  let connected = false;
  try {
    await mongoose.connect(env.MONGO_URI, { autoIndex: false });
    connected = true;
    return await runDiagnostic({ Cliente, ...options });
  } finally {
    if (connected) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`No fue posible ejecutar el diagnostico: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { classifyEntry, main, parseArguments, runDiagnostic };
