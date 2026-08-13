const test = require("node:test");
const assert = require("node:assert/strict");
const { auditModelIndexes, buildIndexMigrationPlan } = require("../services/indexMigrationService");

function model({
  name = "Cliente",
  collection = "clientes",
  expected = [[{ tenantId: 1, numero: 1 }, { unique: true }]],
  current = [],
  missing = 0,
  duplicates = [],
} = {}) {
  return {
    modelName: name,
    schema: { indexes: () => expected },
    collection: {
      collectionName: collection,
      listIndexes: () => ({ toArray: async () => current }),
    },
    countDocuments: async () => missing,
    aggregate: async () => duplicates,
  };
}

const idIndex = { name: "_id_", key: { _id: 1 } };
const customerIndex = { name: "tenantId_1_numero_1", key: { tenantId: 1, numero: 1 }, unique: true };
const legacyCustomer = { name: "numero_1", key: { numero: 1 }, unique: true };

test("Cliente con compuesto correcto propone numero global como dropCandidate", async () => {
  const plan = await auditModelIndexes(model({ current: [idIndex, customerIndex, legacyCustomer] }));
  assert.equal(plan.status, "READY");
  assert.deepEqual(plan.dropCandidates.map(item => item.name), ["numero_1"]);
  assert.ok(plan.keep.some(item => item.name === "tenantId_1_numero_1"));
});

test("Cliente con documentos sin tenant queda BLOCKED y no recomienda drop", async () => {
  const plan = await auditModelIndexes(model({ current: [idIndex, customerIndex, legacyCustomer], missing: 3 }));
  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.blocking[0].code, "missing_tenant");
  assert.deepEqual(plan.dropCandidates, []);
});

test("duplicados por tenant bloquean la migración", async () => {
  const plan = await auditModelIndexes(model({
    current: [idIndex, customerIndex, legacyCustomer],
    duplicates: [{ _id: { tenantId: "a", numero: "5211" }, count: 2 }],
  }));
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blocking.some(item => item.code === "tenant_duplicates"));
});

test("índice compuesto faltante se marca CREATE y bloquea DROP", async () => {
  const plan = await auditModelIndexes(model({ current: [idIndex, legacyCustomer] }));
  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.create.length, 1);
  assert.ok(plan.blocking.some(item => item.code === "tenant_index_missing"));
  assert.deepEqual(plan.dropCandidates, []);
});

for (const [name, field, compound] of [
  ["Categoria", "normalizedName", { tenantId: 1, normalizedName: 1 }],
  ["Cupon", "code", { tenantId: 1, code: 1 }],
]) {
  test(`${name} sólo propone unicidad global tras verificar compuesto`, async () => {
    const legacy = { name: `${field}_1`, key: { [field]: 1 }, unique: true };
    const correct = { name: `tenantId_1_${field}_1`, key: compound, unique: true };
    const plan = await auditModelIndexes(model({
      name, expected: [[compound, { unique: true }]], current: [idIndex, correct, legacy],
    }));
    assert.deepEqual(plan.dropCandidates.map(item => item.name), [`${field}_1`]);
  });
}

test("índice desconocido se conserva como KEEP_UNRECOGNIZED", async () => {
  const unknown = { name: "manual_report_1", key: { manualReport: 1 } };
  const plan = await auditModelIndexes(model({ current: [idIndex, customerIndex, unknown] }));
  assert.equal(plan.unknown[0].name, "manual_report_1");
  assert.equal(plan.unknown[0].action, "KEEP_UNRECOGNIZED");
  assert.deepEqual(plan.dropCandidates, []);
});

test("_id_ siempre se conserva", async () => {
  const plan = await auditModelIndexes(model({ current: [idIndex, customerIndex] }));
  assert.ok(plan.keep.some(item => item.name === "_id_"));
});

test("TTL de ProcessedMessage se reconoce como KEEP", async () => {
  const expected = [[{ createdAt: 1 }, { expireAfterSeconds: 604800 }]];
  const ttl = { name: "createdAt_1", key: { createdAt: 1 }, expireAfterSeconds: 604800 };
  const plan = await auditModelIndexes(model({
    name: "ProcessedMessage", collection: "processedmessages", expected, current: [idIndex, ttl],
  }));
  assert.ok(plan.keep.some(item => item.name === "createdAt_1"));
  assert.deepEqual(plan.dropCandidates, []);
});

test("plan global ordena verificación antes de drops y es READ_ONLY", async () => {
  const plan = await buildIndexMigrationPlan([model({ current: [idIndex, customerIndex] })]);
  assert.equal(plan.mode, "READ_ONLY");
  assert.deepEqual(plan.sequence, [
    "CHECK_BACKFILLS", "CHECK_DUPLICATES", "CREATE_MISSING", "VERIFY_CREATED", "REVIEW_DROP_CANDIDATES",
  ]);
});

test("Combo sin tenant queda BLOCKED aunque no tenga índice unique", async () => {
  const plan = await auditModelIndexes(model({
    name: "Combo",
    expected: [[{ tenantId: 1, active: 1, order: 1 }, {}]],
    current: [idIndex, { name: "tenant_combo", key: { tenantId: 1, active: 1, order: 1 } }],
    missing: 1,
  }));
  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.blocking[0].code, "missing_tenant");
});

test("Producto busca duplicados sólo en legacyId no vacío", async () => {
  let pipeline;
  const Product = model({
    name: "Producto",
    expected: [[{ tenantId: 1, source: 1, legacyId: 1 }, { unique: true }]],
    current: [idIndex, { name: "tenant_legacy", key: { tenantId: 1, source: 1, legacyId: 1 }, unique: true }],
  });
  Product.aggregate = async value => { pipeline = value; return []; };
  await auditModelIndexes(Product);
  assert.equal(pipeline[0].$match.source, "legacy");
  assert.deepEqual(pipeline[0].$match.legacyId, { $type: "string", $gt: "" });
});
