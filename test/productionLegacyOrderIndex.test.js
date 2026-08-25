const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tool = require("../scripts/prepare-legacy-order-index-production");

const baseArgs = ["--destination-environment=production", "--database=test"];
const createArgs = [...baseArgs, "--create", `--confirm=${tool.REQUIRED_CONFIRMATION}`];

function compatible(name = tool.INDEX_NAME) {
  return { name, key: { ...tool.INDEX_KEYS }, unique: true,
    partialFilterExpression: JSON.parse(JSON.stringify(tool.PARTIAL_FILTER)) };
}

function mockDatabase(initialIndexes = []) {
  let indexes = initialIndexes;
  const calls = [];
  const collection = {
    listIndexes() { calls.push(["listIndexes"]); return { toArray: async () => indexes }; },
    async createIndex(keys, options) {
      calls.push(["createIndex", keys, options]);
      indexes = [{ name: options.name, key: keys, unique: options.unique,
        partialFilterExpression: options.partialFilterExpression }];
      return options.name;
    },
  };
  return { calls, databaseName: "test", collection(name) {
    calls.push(["collection", name]); return collection;
  } };
}

test("dry-run informa MISSING sin crear", async () => {
  const db = mockDatabase();
  assert.deepEqual(await tool.prepareIndex(db, { create: false }), { mode: "DRY_RUN", status: "MISSING" });
  assert.equal(db.calls.some(call => call[0] === "createIndex"), false);
});

test("devuelve READY si el indice exacto ya existe", async () => {
  assert.equal((await tool.prepareIndex(mockDatabase([compatible()]), { create: false })).status, "READY");
});

test("crea exclusivamente la definicion exacta con confirmacion correcta", async () => {
  assert.deepEqual(tool.parseArguments(createArgs), { create: true, databaseName: "test" });
  const db = mockDatabase();
  const result = await tool.prepareIndex(db, { create: true });
  const create = db.calls.find(call => call[0] === "createIndex");
  assert.equal(result.status, "CREATED");
  assert.deepEqual(create.slice(1), [tool.INDEX_KEYS, {
    name: tool.INDEX_NAME, unique: true, partialFilterExpression: tool.PARTIAL_FILTER,
  }]);
});

test("rechaza create sin confirmacion y argumentos prohibidos", () => {
  assert.throws(() => tool.parseArguments([...baseArgs, "--create"]),
    error => error.code === "CONFIRMATION_REQUIRED");
  for (const forbidden of ["--apply", "--delete", "--otro"]) {
    assert.throws(() => tool.parseArguments([...baseArgs, forbidden]));
  }
});

test("indice incompatible aborta antes de createIndex", async () => {
  const db = mockDatabase([{ ...compatible(), unique: false }]);
  await assert.rejects(() => tool.prepareIndex(db, { create: true }),
    error => error.code === "INCOMPATIBLE_INDEX");
  assert.equal(db.calls.some(call => call[0] === "createIndex"), false);
});

test("segunda ejecucion es idempotente", async () => {
  const db = mockDatabase();
  assert.equal((await tool.prepareIndex(db, { create: true })).status, "CREATED");
  assert.equal((await tool.prepareIndex(db, { create: true })).status, "READY");
  assert.equal(db.calls.filter(call => call[0] === "createIndex").length, 1);
});

test("selecciona explicitamente la base aunque la URI tenga otra predeterminada", async () => {
  const db = mockDatabase([compatible()]);
  const selected = [];
  const client = { defaultDatabaseName: "otra", db(name) { selected.push(name); return db; } };
  const result = await tool.prepareConnectedClient(client, "test", { create: false });
  assert.deepEqual(selected, ["test"]);
  assert.equal(result.status, "READY");
});

test("fuente permite createIndex como unica operacion de escritura", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts",
    "prepare-legacy-order-index-production.js"), "utf8");
  assert.match(source, /environment\.PRODUCTION_MONGO_URI/);
  assert.doesNotMatch(source, /environment\.(?:MONGO_URI|STAGING_MONGO_URI)/);
  assert.doesNotMatch(source, /dotenv|mongoose/i);
  assert.equal((source.match(/\.createIndex\s*\(/g) || []).length, 1);
  assert.doesNotMatch(source, /\.(?:insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|dropIndex|bulkWrite|save)\s*\(/);
});
