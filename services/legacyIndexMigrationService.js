const REQUIRED_CONFIRMATION = "DROP_LEGACY_UNIQUE_INDEXES";

const APPROVED_LEGACY_INDEXES = Object.freeze([
  Object.freeze({
    model: "Cliente", collection: "clientes", indexName: "numero_1",
    legacyKey: Object.freeze({ numero: 1 }),
    tenantKey: Object.freeze({ tenantId: 1, numero: 1 }),
  }),
  Object.freeze({
    model: "Categoria", collection: "categorias", indexName: "normalizedName_1",
    legacyKey: Object.freeze({ normalizedName: 1 }),
    tenantKey: Object.freeze({ tenantId: 1, normalizedName: 1 }),
  }),
  Object.freeze({
    model: "Cupon", collection: "cupons", indexName: "code_1",
    legacyKey: Object.freeze({ code: 1 }),
    tenantKey: Object.freeze({ tenantId: 1, code: 1 }),
  }),
]);

function sameKey(first = {}, second = {}) {
  return JSON.stringify(Object.entries(first)) === JSON.stringify(Object.entries(second));
}

function exactUniqueIndex(index, key) {
  return Boolean(index) && sameKey(index.key, key) && index.unique === true &&
    index.sparse !== true && index.partialFilterExpression === undefined &&
    index.collation === undefined && index.expireAfterSeconds === undefined;
}

async function inspectApprovedIndex(Model, target) {
  if (!target || Model.collection.collectionName !== target.collection) {
    throw new Error("El modelo no corresponde al objetivo aprobado.");
  }

  const indexes = await Model.collection.listIndexes().toArray();
  const legacy = indexes.find(index => index.name === target.indexName);
  const tenantAware = indexes.find(index => exactUniqueIndex(index, target.tenantKey));
  const missingTenant = await Model.countDocuments({
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });
  const fields = Object.keys(target.tenantKey);
  const duplicates = await Model.aggregate([
    { $match: { tenantId: { $exists: true, $ne: null } } },
    { $group: { _id: Object.fromEntries(fields.map(field => [field, `$${field}`])), count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]);

  const preconditions = {
    missingTenant,
    duplicateGroups: duplicates,
    tenantAwarePresent: Boolean(tenantAware),
    tenantAwareIndex: tenantAware || null,
  };
  let status = "READY";
  let action = `DROP ${target.indexName}`;

  if (!legacy) {
    status = "ALREADY_MIGRATED";
    action = "NONE";
  } else if (!exactUniqueIndex(legacy, target.legacyKey)) {
    status = "MISMATCH";
    action = "NONE";
  } else if (missingTenant > 0 || duplicates.length > 0 || !tenantAware) {
    status = "BLOCKED";
    action = "NONE";
  }

  return {
    model: target.model,
    collection: target.collection,
    target: { name: target.indexName, expectedKey: target.legacyKey, unique: true },
    currentDefinition: legacy || null,
    preconditions,
    status,
    action,
  };
}

async function migrateApprovedIndexes(models, options = {}) {
  const apply = options.apply === true;
  if (apply && options.confirmation !== REQUIRED_CONFIRMATION) {
    return { mode: "APPLY", status: "CONFIRMATION_REQUIRED", results: [] };
  }

  const byCollection = new Map(models.map(Model => [Model.collection.collectionName, Model]));
  const results = [];
  for (const target of APPROVED_LEGACY_INDEXES) {
    const Model = byCollection.get(target.collection);
    if (!Model) continue;

    // In APPLY this inspection is intentionally performed immediately before the drop.
    const inspection = await inspectApprovedIndex(Model, target);
    if (!apply || inspection.status !== "READY") {
      results.push(inspection);
      continue;
    }

    try {
      await Model.collection.dropIndex(target.indexName);
      const indexesAfter = await Model.collection.listIndexes().toArray();
      const legacyPresent = indexesAfter.some(index => index.name === target.indexName);
      const tenantAwarePresent = indexesAfter.some(index => exactUniqueIndex(index, target.tenantKey));
      const verified = !legacyPresent && tenantAwarePresent;
      results.push({
        ...inspection,
        status: verified ? "MIGRATED" : "ERROR",
        action: `DROPPED ${target.indexName}`,
        verification: { legacyPresent, tenantAwarePresent },
        ...(verified ? {} : { error: "La verificación posterior al drop no fue satisfactoria." }),
      });
    } catch (error) {
      results.push({ ...inspection, status: "ERROR", action: "DROP_FAILED", error: error.message });
    }
  }

  return {
    mode: apply ? "APPLY" : "DRY_RUN",
    status: results.some(result => result.status === "ERROR") ? "ERROR" : "COMPLETED",
    strategy: "CONTINUE_INDEPENDENT_TARGETS",
    results,
  };
}

module.exports = {
  APPROVED_LEGACY_INDEXES,
  REQUIRED_CONFIRMATION,
  exactUniqueIndex,
  inspectApprovedIndex,
  migrateApprovedIndexes,
};
