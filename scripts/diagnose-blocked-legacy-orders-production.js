#!/usr/bin/env node

/**
 * Diagnostico temporal y read-only de entradas BLOCKED del backfill legacy en produccion.
 * Uso: npm run diagnose:legacy-orders:blocked
 * La salida contiene una linea JSON por registro bloqueado y ningun dato mas.
 */

const {
  RECORD_STATUS,
  convertLegacyEntry,
  generateStableId,
} = require("../services/legacyOrderBackfillService");

function parseArguments(args) {
  if (args.length > 0) throw new Error("Este diagnostico no acepta argumentos.");
  return {};
}

function diagnosticLegacyEntryId(customer, entry) {
  try {
    return generateStableId(customer?._id, entry);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return generateStableId(customer?._id, { ...entry, fecha: null });
  }
}

function blockedDiagnostic(customer, entry) {
  const conversion = convertLegacyEntry(customer, entry);
  if (conversion.status !== RECORD_STATUS.BLOCKED) return null;

  return {
    legacyEntryId: diagnosticLegacyEntryId(customer, entry),
    blockReason: conversion.reason,
  };
}

async function runDiagnostic({ Cliente, logger = console.log }) {
  const cursor = Cliente.find({
    historialPedidos: { $exists: true, $ne: [] },
  })
    .select("_id tenantId branchId historialPedidos")
    .lean()
    .cursor();

  for await (const customer of cursor) {
    if (!Array.isArray(customer.historialPedidos)) continue;
    for (const entry of customer.historialPedidos) {
      const result = blockedDiagnostic(customer, entry);
      if (result) logger(JSON.stringify(result));
    }
  }
}

async function main(args = process.argv.slice(2)) {
  parseArguments(args);

  // Carga tardia para rechazar argumentos antes de preparar MongoDB.
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const Cliente = require("../models/Cliente");
  let connected = false;

  try {
    await mongoose.connect(env.MONGO_URI, { autoIndex: false });
    connected = true;
    await runDiagnostic({ Cliente });
  } finally {
    if (connected) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error("No fue posible ejecutar el diagnostico read-only.");
    process.exitCode = 1;
  });
}

module.exports = {
  blockedDiagnostic,
  diagnosticLegacyEntryId,
  main,
  parseArguments,
  runDiagnostic,
};
