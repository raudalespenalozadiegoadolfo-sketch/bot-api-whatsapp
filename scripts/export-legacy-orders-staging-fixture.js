#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { BSON, ObjectId } = require("mongodb");
const { EJSON } = BSON;
const {
  RECORD_STATUS,
  convertLegacyEntry,
} = require("../services/legacyOrderBackfillService");

const FIXTURE_VERSION = "legacy-orders-staging-v1";
const EXPECTED = Object.freeze({ customers: 4, entries: 39, migratable: 36, blocked: 3 });

function parseArguments(args) {
  if (args.some(value => value === "--apply" || value.startsWith("--apply="))) {
    throw new Error("--apply no esta permitido.");
  }
  const source = args.find(value => value.startsWith("--source-environment="));
  const output = args.find(value => value.startsWith("--output="));
  const allowed = new Set([source, output].filter(Boolean));
  const unknown = args.filter(value => !allowed.has(value));
  if (unknown.length) throw new Error(`Argumento no permitido: ${unknown[0]}`);
  if (source?.slice("--source-environment=".length) !== "production") {
    throw new Error("--source-environment=production es obligatorio.");
  }
  const outputDirectory = output?.slice("--output=".length).trim();
  if (!outputDirectory) throw new Error("--output es obligatorio.");
  return { outputDirectory };
}

function deterministicObjectId(kind, value) {
  const hex = crypto.createHash("sha256").update(`${FIXTURE_VERSION}:${kind}:${String(value)}`).digest("hex").slice(0, 24);
  return new ObjectId(hex);
}

function deterministicProductName(item) {
  const token = crypto.createHash("sha256")
    .update(JSON.stringify([String(item?.nombre || ""), Number(item?.precio), Number(item?.cantidad)]))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `Producto-${token}`;
}

function countClassifications(customers) {
  const counts = { customers: customers.length, entries: 0, migratable: 0, blocked: 0 };
  for (const customer of customers) {
    for (const entry of customer.historialPedidos || []) {
      counts.entries += 1;
      const result = convertLegacyEntry(customer, entry);
      if (result.status === RECORD_STATUS.READY) counts.migratable += 1;
      else counts.blocked += 1;
    }
  }
  return counts;
}

function assertExpectedCounts(counts) {
  for (const [field, expected] of Object.entries(EXPECTED)) {
    if (counts[field] !== expected) {
      throw new Error(`Conteo inesperado para ${field}: esperado ${expected}, recibido ${counts[field]}.`);
    }
  }
}

function copyIfPresent(target, source, field, transform = value => value) {
  if (Object.prototype.hasOwnProperty.call(source || {}, field)) target[field] = transform(source[field]);
}

function sanitizeItem(item) {
  const sanitized = { nameMarker: deterministicProductName(item) };
  copyIfPresent(sanitized, item, "precio");
  copyIfPresent(sanitized, item, "cantidad");
  return {
    nombre: sanitized.nameMarker,
    ...(Object.prototype.hasOwnProperty.call(sanitized, "precio") ? { precio: sanitized.precio } : {}),
    ...(Object.prototype.hasOwnProperty.call(sanitized, "cantidad") ? { cantidad: sanitized.cantidad } : {}),
    productId: null,
  };
}

function sanitizeHistoryEntry(entry, customerKey, index) {
  const sanitized = {
    _id: deterministicObjectId("history", `${customerKey}:${index}`),
    pedidos: Array.isArray(entry?.pedidos) ? entry.pedidos.map(sanitizeItem) : [],
    nombre: "",
    numero: "",
    direccion: null,
    motivoCancelacion: "",
  };
  copyIfPresent(sanitized, entry, "fecha", value => new Date(value));
  copyIfPresent(sanitized, entry, "estadoFinal");
  copyIfPresent(sanitized, entry, "total");
  return sanitized;
}

function sanitizeCustomer(customer, index) {
  const customerKey = String(customer._id);
  return {
    _id: deterministicObjectId("customer", customerKey),
    tenantId: deterministicObjectId("tenant", customer.tenantId),
    branchId: customer.branchId ? deterministicObjectId("branch", customer.branchId) : null,
    numero: `staging-customer-${String(index + 1).padStart(3, "0")}`,
    nombre: "",
    direccion: null,
    pedidos: [],
    historialPedidos: (customer.historialPedidos || []).map((entry, entryIndex) =>
      sanitizeHistoryEntry(entry, customerKey, entryIndex)
    ),
    productoPendiente: null,
    pedidoOrigen: "whatsapp",
    paso: "inicio",
    estadoPedido: "sin_pedido",
  };
}

function sanitizeTenant(tenant, index) {
  return {
    _id: deterministicObjectId("tenant", tenant._id),
    name: `Tenant staging ${index + 1}`,
    slug: `tenant-staging-${index + 1}`,
    storefrontKey: `tenant-staging-${index + 1}`,
    status: "active",
    timezone: tenant.timezone || "America/Mexico_City",
    currency: tenant.currency || "MXN",
    businessType: tenant.businessType || "other",
  };
}

function sanitizeBranch(branch, index) {
  return {
    _id: deterministicObjectId("branch", branch._id),
    tenantId: deterministicObjectId("tenant", branch.tenantId),
    name: `Sucursal staging ${index + 1}`,
    slug: `sucursal-staging-${index + 1}`,
    active: branch.active !== false,
    timezone: branch.timezone || null,
  };
}

function buildFixture({ customers, tenants, branches }) {
  const tenantIds = new Set(tenants.map(value => String(value._id)));
  const branchIds = new Set(branches.map(value => String(value._id)));
  for (const customer of customers) {
    if (!tenantIds.has(String(customer.tenantId))) {
      throw new Error("No se encontro el tenant referenciado por un cliente.");
    }
    if (customer.branchId && !branchIds.has(String(customer.branchId))) {
      throw new Error("No se encontro la branch referenciada por un cliente.");
    }
  }
  const sourceCounts = countClassifications(customers);
  assertExpectedCounts(sourceCounts);
  const sanitizedCustomers = customers.map(sanitizeCustomer);
  const sanitizedCounts = countClassifications(sanitizedCustomers);
  assertExpectedCounts(sanitizedCounts);
  return {
    version: FIXTURE_VERSION,
    collections: {
      tenants: tenants.map(sanitizeTenant),
      branches: branches.map(sanitizeBranch),
      clientes: sanitizedCustomers,
      orders: [],
    },
    counts: sanitizedCounts,
  };
}

function serializeFixture(fixture) {
  return EJSON.stringify(fixture, { relaxed: false });
}

function fixtureHash(serialized) {
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function writeFixture(outputDirectory, fixture) {
  const resolved = path.resolve(outputDirectory);
  fs.mkdirSync(resolved, { recursive: true });
  const fixtureText = serializeFixture(fixture);
  const manifest = {
    version: FIXTURE_VERSION,
    fixtureFile: "legacy-orders.ejson",
    sha256: fixtureHash(fixtureText),
    counts: fixture.counts,
  };
  fs.writeFileSync(path.join(resolved, manifest.fixtureFile), fixtureText, { encoding: "utf8", flag: "wx" });
  fs.writeFileSync(path.join(resolved, "manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
  return manifest;
}

async function readSource(db) {
  const customers = await db.collection("clientes")
    .find({ historialPedidos: { $exists: true, $ne: [] } }, {
      projection: {
        _id: 1,
        tenantId: 1,
        branchId: 1,
        "historialPedidos.fecha": 1,
        "historialPedidos.estadoFinal": 1,
        "historialPedidos.pedidos.nombre": 1,
        "historialPedidos.pedidos.precio": 1,
        "historialPedidos.pedidos.cantidad": 1,
        "historialPedidos.total": 1,
      },
    })
    .toArray();
  const tenantIds = [...new Set(customers.map(value => String(value.tenantId)))].map(value => new ObjectId(value));
  const branchIds = [...new Set(customers.filter(value => value.branchId).map(value => String(value.branchId)))].map(value => new ObjectId(value));
  const tenants = await db.collection("tenants").find(
    { _id: { $in: tenantIds } },
    { projection: { _id: 1, timezone: 1, currency: 1, businessType: 1 } }
  ).toArray();
  const branches = branchIds.length
    ? await db.collection("branches").find(
      { _id: { $in: branchIds } },
      { projection: { _id: 1, tenantId: 1, active: 1, timezone: 1 } }
    ).toArray()
    : [];
  return { customers, tenants, branches };
}

async function main(args = process.argv.slice(2), environment = process.env) {
  const { outputDirectory } = parseArguments(args);
  const sourceUri = environment.SOURCE_MONGO_URI;
  if (!sourceUri) throw new Error("SOURCE_MONGO_URI es obligatoria.");
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(sourceUri);
  try {
    await client.connect();
    const db = client.db();
    if (!db.databaseName || db.databaseName === "marisco_alegre_staging") {
      throw new Error("La base de origen no puede ser staging.");
    }
    const fixture = buildFixture(await readSource(db));
    writeFixture(outputDirectory, fixture);
    console.log(JSON.stringify({ ok: true, version: FIXTURE_VERSION, counts: fixture.counts }));
  } finally {
    await client.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error("No fue posible generar el fixture; los detalles sensibles fueron omitidos.");
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED,
  FIXTURE_VERSION,
  assertExpectedCounts,
  buildFixture,
  countClassifications,
  deterministicObjectId,
  fixtureHash,
  parseArguments,
  sanitizeCustomer,
  serializeFixture,
  writeFixture,
};
