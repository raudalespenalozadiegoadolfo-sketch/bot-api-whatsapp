const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DATABASE_NAME,
  ERROR_CODES,
  LEGACY_TENANT,
  TENANT_SLUG,
  main,
  parseArguments,
  prepareLegacyTenant,
  run,
} = require("../scripts/prepare-legacy-tenant-staging");

function tenantCollection({ count = 0, inserts = [] } = {}) {
  return {
    countDocuments: async filter => {
      assert.deepEqual(filter, { slug: TENANT_SLUG });
      return count;
    },
    insertOne: async document => {
      inserts.push(document);
      return { acknowledged: true, insertedId: "hidden" };
    },
  };
}

function dbMock(collection) {
  return {
    databaseName: DATABASE_NAME,
    collection(name) {
      assert.equal(name, "tenants");
      return collection;
    },
  };
}

test("fija staging, tenant y argumentos", () => {
  assert.equal(DATABASE_NAME, "marisco_alegre_staging");
  assert.equal(TENANT_SLUG, "marisco-alegre");
  assert.deepEqual(parseArguments([]), { apply: false });
  assert.deepEqual(parseArguments(["--apply"]), { apply: true });
  assert.throws(() => parseArguments(["--apply", "--production"]), /INVALID_ARGUMENT/);
});

test("DRY_RUN no escribe cuando falta el tenant", async () => {
  const inserts = [];
  const result = await prepareLegacyTenant({ db: dbMock(tenantCollection({ inserts })) });
  assert.deepEqual(result, {
    mode: "DRY_RUN",
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    status: "WOULD_CREATE",
    existingMatches: 0,
  });
  assert.deepEqual(inserts, []);
});

test("--apply crea únicamente el tenant esperado", async () => {
  const inserts = [];
  const result = await prepareLegacyTenant({
    db: dbMock(tenantCollection({ inserts })),
    apply: true,
  });
  assert.equal(result.status, "CREATED");
  assert.deepEqual(inserts, [LEGACY_TENANT]);
});

test("segunda ejecución es idempotente y no duplica", async () => {
  const inserts = [];
  const result = await prepareLegacyTenant({
    db: dbMock(tenantCollection({ count: 1, inserts })),
    apply: true,
  });
  assert.deepEqual(result, {
    mode: "APPLY",
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    status: "ALREADY_EXISTS",
    existingMatches: 1,
  });
  assert.deepEqual(inserts, []);
});

test("aborta de forma segura si hay duplicados", async () => {
  await assert.rejects(
    () => prepareLegacyTenant({ db: dbMock(tenantCollection({ count: 2 })) }),
    error => error.message === ERROR_CODES.DUPLICATE_LEGACY_TENANT
  );
});

test("rechaza otra base y no toca colecciones ni índices", async () => {
  await assert.rejects(
    () => prepareLegacyTenant({ db: { databaseName: "otra_base", collection: () => { throw new Error("unexpected"); } } }),
    error => error.message === ERROR_CODES.WRONG_DATABASE
  );
  const source = require("fs").readFileSync(require.resolve("../scripts/prepare-legacy-tenant-staging"), "utf8");
  assert.doesNotMatch(source, /createIndex|dropIndex|syncIndexes|updateMany|save|deleteMany|bulkWrite/);
});

test("no conecta a MongoDB real durante las pruebas y clasifica errores seguros", async () => {
  class ForbiddenClient {
    constructor() { throw new Error("NO_REAL_CONNECTION"); }
  }
  await assert.rejects(
    () => run({ uri: "mongodb://not-used", MongoClientClass: ForbiddenClient }),
    error => error.message === ERROR_CODES.CONNECTION_FAILED
  );
  await assert.rejects(() => main([], {}), error => error.message === ERROR_CODES.MONGO_URI_MISSING);
});