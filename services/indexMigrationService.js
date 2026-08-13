const LEGACY_INDEX_PATTERNS = Object.freeze({
  Cliente: [{ key: { numero: 1 }, unique: true, reason: "Unicidad global de teléfono" }],
  Categoria: [
    { key: { normalizedName: 1 }, unique: true, reason: "Unicidad global de categoría" },
    { key: { active: 1 }, reason: "Consulta global legacy" },
  ],
  Cupon: [
    { key: { code: 1 }, unique: true, reason: "Unicidad global de cupón" },
    { key: { active: 1 }, reason: "Consulta global legacy" },
    { key: { active: 1, order: 1 }, reason: "Orden global legacy" },
  ],
  Producto: ["legacyId", "source", "name", "category", "type", "active"].map(field => ({
    key: { [field]: 1 }, reason: `Índice simple legacy ${field}`,
  })),
  Combo: [
    { key: { name: 1 }, reason: "Nombre global legacy" },
    { key: { active: 1 }, reason: "Consulta global legacy" },
  ],
});

const TENANT_UNIQUE_KEYS = Object.freeze({
  Cliente: ["tenantId", "numero"],
  Categoria: ["tenantId", "normalizedName"],
  Cupon: ["tenantId", "code"],
  Producto: ["tenantId", "source", "legacyId"],
});

const TENANT_SCOPED_MODELS = new Set([
  "Cliente", "Categoria", "Producto", "Combo", "Cupon",
]);

function normalizeKey(key = {}) {
  return Object.entries(key).map(([field, direction]) => [field, direction]);
}

function sameKey(first, second) {
  return JSON.stringify(normalizeKey(first)) === JSON.stringify(normalizeKey(second));
}

function sameDefinition(current, expected) {
  return sameKey(current.key, expected.key) &&
    Boolean(current.unique) === Boolean(expected.unique) &&
    (current.expireAfterSeconds ?? null) === (expected.expireAfterSeconds ?? null) &&
    JSON.stringify(current.partialFilterExpression || null) ===
      JSON.stringify(expected.partialFilterExpression || null);
}

function expectedIndexesFromModel(Model) {
  return Model.schema.indexes().map(([key, options]) => ({
    key,
    unique: Boolean(options.unique),
    ...(options.expireAfterSeconds !== undefined
      ? { expireAfterSeconds: options.expireAfterSeconds }
      : {}),
    ...(options.partialFilterExpression
      ? { partialFilterExpression: options.partialFilterExpression }
      : {}),
  }));
}

async function checkTenantPreconditions(Model, modelName) {
  if (!TENANT_SCOPED_MODELS.has(modelName)) return [];
  const blocking = [];
  const missingTenant = await Model.countDocuments({
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });
  if (missingTenant > 0) {
    blocking.push({ code: "missing_tenant", count: missingTenant });
  }

  const fields = TENANT_UNIQUE_KEYS[modelName];
  if (!fields) return blocking;
  const id = Object.fromEntries(fields.map(field => [field, `$${field}`]));
  const duplicateMatch = {
    tenantId: { $exists: true, $ne: null },
    ...(modelName === "Producto"
      ? { source: "legacy", legacyId: { $type: "string", $gt: "" } }
      : {}),
  };
  const duplicates = await Model.aggregate([
    { $match: duplicateMatch },
    { $group: { _id: id, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]);
  if (duplicates.length) {
    blocking.push({ code: "tenant_duplicates", groups: duplicates });
  }
  return blocking;
}

async function auditModelIndexes(Model) {
  const modelName = Model.modelName;
  const collection = Model.collection.collectionName;
  const current = await Model.collection.listIndexes().toArray();
  const expected = expectedIndexesFromModel(Model);
  const keep = current.filter(index =>
    index.name === "_id_" || expected.some(item => sameDefinition(index, item))
  );
  const create = expected.filter(item => !current.some(index => sameDefinition(index, item)));
  const blocking = await checkTenantPreconditions(Model, modelName);
  const patterns = LEGACY_INDEX_PATTERNS[modelName] || [];
  const legacyFound = current.filter(index => patterns.some(pattern =>
    sameKey(index.key, pattern.key) &&
    (pattern.unique === undefined || Boolean(index.unique) === pattern.unique)
  ));
  const tenantIndexMissing = create.some(index => Object.keys(index.key)[0] === "tenantId");
  if (tenantIndexMissing && legacyFound.length) {
    blocking.push({ code: "tenant_index_missing", count: legacyFound.length });
  }
  const dropCandidates = blocking.length ? [] : legacyFound.map(index => ({
    name: index.name,
    key: index.key,
    reason: patterns.find(pattern => sameKey(index.key, pattern.key))?.reason,
  }));
  const recognized = new Set([...keep, ...legacyFound].map(index => index.name));
  const unknown = current.filter(index => !recognized.has(index.name)).map(index => ({
    ...index,
    action: "KEEP_UNRECOGNIZED",
  }));
  return {
    model: modelName,
    collection,
    status: blocking.length ? "BLOCKED" : "READY",
    keep,
    create,
    dropCandidates,
    blocking,
    unknown,
  };
}

async function buildIndexMigrationPlan(models) {
  const collections = [];
  for (const Model of models) collections.push(await auditModelIndexes(Model));
  return {
    mode: "READ_ONLY",
    status: collections.some(item => item.status === "BLOCKED") ? "BLOCKED" : "READY",
    sequence: ["CHECK_BACKFILLS", "CHECK_DUPLICATES", "CREATE_MISSING", "VERIFY_CREATED", "REVIEW_DROP_CANDIDATES"],
    collections,
  };
}

module.exports = {
  LEGACY_INDEX_PATTERNS,
  TENANT_UNIQUE_KEYS,
  TENANT_SCOPED_MODELS,
  auditModelIndexes,
  buildIndexMigrationPlan,
  expectedIndexesFromModel,
  sameDefinition,
  sameKey,
};
