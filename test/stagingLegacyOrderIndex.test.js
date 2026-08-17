const test = require("node:test");
const assert = require("node:assert/strict");
const tool = require("../scripts/prepare-legacy-order-index-staging");

const baseArgs = ["--destination-environment=staging", "--database=marisco_alegre_staging"];
const compatible = (name = tool.INDEX_NAME) => ({
  name, key: { ...tool.INDEX_KEYS }, unique: true,
  partialFilterExpression: JSON.parse(JSON.stringify(tool.PARTIAL_FILTER)),
});

test("argumentos fijan staging y separan dry-run de creación confirmada", () => {
  assert.deepEqual(tool.parseArguments(baseArgs), { create: false });
  assert.throws(() => tool.parseArguments([...baseArgs, "--apply"]), error => error.code === "INVALID_ARGUMENT");
  assert.throws(() => tool.parseArguments(["--destination-environment=staging", "--database=production"]),
    error => error.code === "INVALID_ARGUMENT" || error.code === "WRONG_DATABASE");
  assert.throws(() => tool.parseArguments([...baseArgs, "--create"]), error => error.code === "CONFIRMATION_REQUIRED");
  assert.deepEqual(tool.parseArguments([...baseArgs, "--create", `--confirm=${tool.REQUIRED_CONFIRMATION}`]),
    { create: true });
});

test("reconoce el índice exacto y rechaza mismo nombre o propósito incompatible", () => {
  assert.equal(tool.inspectIndexes([compatible()]).status, "READY");
  assert.equal(tool.inspectIndexes([compatible("otro-nombre")]).status, "READY");
  assert.throws(() => tool.inspectIndexes([{ ...compatible(), unique: false }]), error => error.code === "INCOMPATIBLE_INDEX");
  assert.throws(() => tool.inspectIndexes([{ name: tool.INDEX_NAME, key: { tenantId: 1 }, unique: true }]),
    error => error.code === "INCOMPATIBLE_INDEX");
  assert.throws(() => tool.inspectIndexes([compatible(), { ...compatible("duplicado"), unique: false }]),
    error => error.code === "INCOMPATIBLE_INDEX");
});

test("dry-run no crea índices", async () => {
  let creates = 0;
  const db = { databaseName: tool.DATABASE_NAME, collection: () => ({
    listIndexes: () => ({ toArray: async () => [] }),
    createIndex: async () => { creates += 1; },
  }) };
  assert.deepEqual(await tool.prepareIndex(db, { create: false }), { mode: "DRY_RUN", status: "MISSING" });
  assert.equal(creates, 0);
});

test("creación verifica el índice y una segunda ejecución es idempotente", async () => {
  let indexes = [];
  let creates = 0;
  const collection = {
    listIndexes: () => ({ toArray: async () => indexes }),
    async createIndex(keys, options) {
      creates += 1;
      indexes = [{ name: options.name, key: keys, unique: options.unique,
        partialFilterExpression: options.partialFilterExpression }];
      return options.name;
    },
  };
  const db = { databaseName: tool.DATABASE_NAME, collection: name => {
    assert.equal(name, "orders"); return collection;
  } };
  assert.equal((await tool.prepareIndex(db, { create: true })).status, "CREATED");
  assert.equal((await tool.prepareIndex(db, { create: true })).status, "READY");
  assert.equal(creates, 1);
});

test("nunca opera sobre otra base", async () => {
  await assert.rejects(() => tool.prepareIndex({ databaseName: "production" }, { create: true }),
    error => error.code === "WRONG_DATABASE");
});

test("errores se reducen a codigo y etapa sin conservar detalles sensibles", () => {
  const original = { code: 13, message: "mongodb://usuario:secreto@hostname/documento", stack: "contenido" };
  const safe = tool.classifyError(original, "INDEX_CREATE");
  const output = { code: safe.code, stage: safe.stage, message: safe.message };
  assert.deepEqual(output, {
    code: "PERMISSION_DENIED",
    stage: "INDEX_CREATE",
    message: "No fue posible preparar el indice; los detalles internos fueron omitidos.",
  });
  assert.doesNotMatch(JSON.stringify(output), /mongodb|usuario|secreto|hostname|documento|contenido/);
});
