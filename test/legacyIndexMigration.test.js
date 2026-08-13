const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APPROVED_LEGACY_INDEXES,
  REQUIRED_CONFIRMATION,
  inspectApprovedIndex,
  migrateApprovedIndexes,
} = require("../services/legacyIndexMigrationService");

function fakeModel({
  name = "Cliente",
  collection = "clientes",
  indexes,
  missing = 0,
  duplicates = [],
  afterDrop,
} = {}) {
  let current = indexes || [
    { name: "_id_", key: { _id: 1 } },
    { name: "numero_1", key: { numero: 1 }, unique: true },
    { name: "tenantId_1_numero_1", key: { tenantId: 1, numero: 1 }, unique: true },
  ];
  const drops = [];
  return {
    modelName: name,
    collection: {
      collectionName: collection,
      listIndexes: () => ({ toArray: async () => current }),
      dropIndex: async indexName => {
        drops.push(indexName);
        current = afterDrop || current.filter(index => index.name !== indexName);
      },
    },
    countDocuments: async () => missing,
    aggregate: async () => duplicates,
    drops,
  };
}

const definitions = {
  categorias: {
    name: "Categoria", legacy: "normalizedName_1", legacyKey: { normalizedName: 1 },
    tenantName: "tenantId_1_normalizedName_1", tenantKey: { tenantId: 1, normalizedName: 1 },
  },
  cupons: {
    name: "Cupon", legacy: "code_1", legacyKey: { code: 1 },
    tenantName: "tenantId_1_code_1", tenantKey: { tenantId: 1, code: 1 },
  },
};

function scopedModel(collection) {
  const value = definitions[collection];
  return fakeModel({
    name: value.name,
    collection,
    indexes: [
      { name: "_id_", key: { _id: 1 } },
      { name: value.legacy, key: value.legacyKey, unique: true },
      { name: value.tenantName, key: value.tenantKey, unique: true },
    ],
  });
}

test("dry-run nunca llama dropIndex", async () => {
  const Model = fakeModel();
  const result = await migrateApprovedIndexes([Model]);
  assert.equal(result.mode, "DRY_RUN");
  assert.deepEqual(Model.drops, []);
});

test("Cliente queda READY con índice compuesto correcto", async () => {
  assert.equal((await inspectApprovedIndex(fakeModel(), APPROVED_LEGACY_INDEXES[0])).status, "READY");
});

test("Cliente queda BLOCKED por documento sin tenant", async () => {
  const result = await inspectApprovedIndex(fakeModel({ missing: 1 }), APPROVED_LEGACY_INDEXES[0]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.preconditions.missingTenant, 1);
});

test("Cliente queda BLOCKED por duplicados", async () => {
  const duplicates = [{ _id: { tenantId: "a", numero: "1" }, count: 2 }];
  const result = await inspectApprovedIndex(fakeModel({ duplicates }), APPROVED_LEGACY_INDEXES[0]);
  assert.equal(result.status, "BLOCKED");
});

test("Cliente queda BLOCKED si falta el índice tenant-aware", async () => {
  const Model = fakeModel({ indexes: [{ name: "numero_1", key: { numero: 1 }, unique: true }] });
  assert.equal((await inspectApprovedIndex(Model, APPROVED_LEGACY_INDEXES[0])).status, "BLOCKED");
});

test("nombre aprobado con definición distinta produce MISMATCH", async () => {
  const Model = fakeModel({ indexes: [
    { name: "numero_1", key: { otro: 1 }, unique: true },
    { name: "tenant", key: { tenantId: 1, numero: 1 }, unique: true },
  ] });
  assert.equal((await inspectApprovedIndex(Model, APPROVED_LEGACY_INDEXES[0])).status, "MISMATCH");
});

test("Categoria queda READY", async () => {
  assert.equal((await inspectApprovedIndex(scopedModel("categorias"), APPROVED_LEGACY_INDEXES[1])).status, "READY");
});

test("Cupon queda READY", async () => {
  assert.equal((await inspectApprovedIndex(scopedModel("cupons"), APPROVED_LEGACY_INDEXES[2])).status, "READY");
});

test("índice no encontrado queda ALREADY_MIGRATED", async () => {
  const Model = fakeModel({ indexes: [{ name: "tenant", key: { tenantId: 1, numero: 1 }, unique: true }] });
  assert.equal((await inspectApprovedIndex(Model, APPROVED_LEGACY_INDEXES[0])).status, "ALREADY_MIGRATED");
});

async function migrateWithExtraIndex(extraIndex) {
  const Model = fakeModel({ indexes: [
    { name: "_id_", key: { _id: 1 } },
    { name: "numero_1", key: { numero: 1 }, unique: true },
    { name: "tenant", key: { tenantId: 1, numero: 1 }, unique: true },
    extraIndex,
  ] });
  await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  return Model.drops;
}

test("índice desconocido nunca se elimina", async () => {
  assert.deepEqual(await migrateWithExtraIndex({ name: "manual_1", key: { manual: 1 } }), ["numero_1"]);
});

test("índice _id_ nunca se elimina", async () => {
  assert.deepEqual(await migrateWithExtraIndex({ name: "other_1", key: { other: 1 } }), ["numero_1"]);
});

test("índices simples legacy no se eliminan", async () => {
  assert.deepEqual(await migrateWithExtraIndex({ name: "active_1", key: { active: 1 } }), ["numero_1"]);
});

test("apply sin confirmación exacta no modifica", async () => {
  const Model = fakeModel();
  const result = await migrateApprovedIndexes([Model], { apply: true, confirmation: "incorrecta" });
  assert.equal(result.status, "CONFIRMATION_REQUIRED");
  assert.deepEqual(Model.drops, []);
});

test("apply confirmado elimina sólo la allowlist y verifica el compuesto", async () => {
  const Model = fakeModel();
  const result = await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  assert.deepEqual(Model.drops, ["numero_1"]);
  assert.equal(result.results[0].status, "MIGRATED");
  assert.equal(result.results[0].verification.tenantAwarePresent, true);
});

test("verificación posterior confirma que desapareció el legacy", async () => {
  const result = await migrateApprovedIndexes([fakeModel()], {
    apply: true, confirmation: REQUIRED_CONFIRMATION,
  });
  assert.equal(result.results[0].verification.legacyPresent, false);
});

test("fallo de verificación posterior produce ERROR", async () => {
  const Model = fakeModel({ afterDrop: [] });
  const result = await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  assert.equal(result.results[0].status, "ERROR");
});

test("una colección bloqueada no ejecuta drop", async () => {
  const Model = fakeModel({ missing: 2 });
  const result = await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  assert.equal(result.results[0].status, "BLOCKED");
  assert.deepEqual(Model.drops, []);
});

test("reejecución después de migrar es idempotente", async () => {
  const Model = fakeModel();
  await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  const second = await migrateApprovedIndexes([Model], { apply: true, confirmation: REQUIRED_CONFIRMATION });
  assert.equal(second.results[0].status, "ALREADY_MIGRATED");
  assert.deepEqual(Model.drops, ["numero_1"]);
});
