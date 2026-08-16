const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  REQUIRED_CONFIRMATION,
  generateStableId,
} = require("../services/legacyOrderBackfillService");

const projectRoot = path.join(__dirname, "..");

test("solo migrate:legacy-orders expone la migracion de historial", () => {
  const packageJson = require("../package.json");
  const migrationScripts = Object.entries(packageJson.scripts).filter(([name, command]) =>
    /orders?-history|legacy-orders|orderHistoryMigration|backfill-legacy-orders/.test(`${name} ${command}`)
  );

  assert.deepEqual(migrationScripts, [
    ["migrate:legacy-orders", "node scripts/backfill-legacy-orders.js"],
  ]);
});

test("el CLI autorizado delega exclusivamente al servicio oficial", () => {
  const cli = fs.readFileSync(
    path.join(projectRoot, "scripts", "backfill-legacy-orders.js"),
    "utf8"
  );

  assert.match(cli, /services\/legacyOrderBackfillService/);
  assert.doesNotMatch(cli, /orderHistoryMigrationService|MIGRATE_LEGACY_ORDER_HISTORY/);
  assert.equal(REQUIRED_CONFIRMATION, "MIGRATE_LEGACY_ORDERS");
});

test("no permanece una implementacion alternativa de historial", () => {
  assert.equal(fs.existsSync(path.join(projectRoot, "services", "orderHistoryMigrationService.js")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "scripts", "migrate-order-history.js")), false);

  for (const directory of ["services", "scripts"]) {
    for (const filename of fs.readdirSync(path.join(projectRoot, directory))) {
      if (!filename.endsWith(".js")) continue;
      const source = fs.readFileSync(path.join(projectRoot, directory, filename), "utf8");
      assert.doesNotMatch(source, /MIGRATE_LEGACY_ORDER_HISTORY|deterministicLegacyEntryId/);
    }
  }
});

test("el _id del subdocumento no puede crear una identidad alternativa", () => {
  const baseEntry = {
    fecha: new Date("2025-01-02T10:00:00.000Z"),
    estadoFinal: "entregado",
    pedidos: [{ nombre: "Camarones", precio: 180, cantidad: 2 }],
    total: 360,
  };

  const first = generateStableId("customer-a", { ...baseEntry, _id: "legacy-entry-a" });
  const second = generateStableId("customer-a", { ...baseEntry, _id: "legacy-entry-b" });

  assert.equal(first, second);
});
