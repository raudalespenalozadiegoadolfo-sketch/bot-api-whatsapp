const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { classifyEntry, parseArguments, runDiagnostic } = require("../scripts/backfill-diagnose");
const projectRoot = path.join(__dirname, "..");

function customer() {
  return { _id: "customer-a", tenantId: "tenant-a", branchId: null };
}

function entry(estadoFinal) {
  return {
    fecha: new Date("2025-01-02T10:00:00.000Z"),
    estadoFinal,
    pedidos: [{ nombre: "Producto privado", precio: 100, cantidad: 1 }],
    total: 100,
    nombre: "Nombre privado",
    numero: "5215512345678",
    direccion: { calle: "Direccion privada" },
  };
}

test("diagnostico rechaza apply y exige ambas identidades", () => {
  assert.throws(() => parseArguments(["--apply"]), /no esta permitido/);
  assert.throws(() => parseArguments(["--customer-id=a"]), /obligatorios/);
  assert.throws(() => parseArguments(["--tenant-id=a"]), /obligatorios/);
  assert.deepEqual(
    parseArguments(["--customer-id=customer-a", "--tenant-id=tenant-a"]),
    { customerId: "customer-a", tenantId: "tenant-a" }
  );
});

test("solo entregado y cancelado pueden clasificarse como migrables", () => {
  for (const status of ["entregado", "cancelado"]) {
    assert.equal(classifyEntry(customer(), entry(status)).classification, "MIGRATABLE");
  }
  for (const status of [undefined, "confirmado", "cocina", "en_camino", "desconocido"]) {
    assert.equal(classifyEntry(customer(), entry(status)).classification, "NOT_MIGRATABLE");
  }
});

test("salida diagnostica no expone PII ni contenido de articulos", async () => {
  const logs = [];
  const Cliente = {
    findOne() {
      return {
        select() { return this; },
        async lean() { return { ...customer(), historialPedidos: [entry(undefined)] }; },
      };
    },
  };
  await runDiagnostic({
    Cliente,
    customerId: "customer-a",
    tenantId: "tenant-a",
    logger: value => logs.push(value),
  });
  const output = logs.join("\n");
  assert.doesNotMatch(output, /Nombre privado|5215512345678|Direccion privada|Producto privado/);
  assert.match(output, /NOT_MIGRATABLE/);
});

test("herramientas de diagnostico no escriben ni contienen IDs hardcodeados", () => {
  const source = fs.readFileSync(path.join(projectRoot, "scripts", "backfill-diagnose.js"), "utf8");
  assert.match(source, /autoIndex: false/);
  assert.doesNotMatch(source, /\.(?:create|updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|bulkWrite|save)\s*\(/);
  assert.doesNotMatch(source, /[a-f\d]{24}/i);
  assert.equal(fs.existsSync(path.join(projectRoot, "test-blocked-entries.js")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "inspect-items.js")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "scripts", "inspect-blocked.js")), false);
});

test("npm test descubre exclusivamente pruebas reales del directorio test", () => {
  const packageJson = require("../package.json");
  assert.match(packageJson.scripts.test, /test\/\*\.test\.js/);
  assert.doesNotMatch(packageJson.scripts.test, /test-blocked-entries/);
});
