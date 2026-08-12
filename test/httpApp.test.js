const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { loadWithMocks } = require("../test-support/moduleMocks");

const testEnv = {
  TOKEN: "test-token",
  PHONE_NUMBER_ID: "test-phone-id",
  VERIFY_TOKEN: "verify-test",
  APP_SECRET: "app-secret-test",
  MONGO_URI: "mongodb://test.invalid/test",
  PANEL_API_KEY: "",
  GRAPH_API_VERSION: "v22.0",
  PORT: 0,
  STORE_URL: "http://localhost/tienda",
  RESTAURANT_NAME: "Restaurante Test",
};

function queryResult(value) {
  return {
    sort() { return this; },
    populate() { return this; },
    async lean() { return value; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function makeClient(overrides = {}) {
  return {
    _id: "client-1",
    numero: "5215512345678",
    nombre: "Ana",
    direccion: null,
    pedidos: [],
    historialPedidos: [],
    estadoPedido: "sin_pedido",
    paso: "inicio",
    productoPendiente: null,
    async save() {},
    ...overrides,
  };
}

function clearApplicationModules() {
  const projectRoot = path.resolve(
    __dirname,
    ".."
  );

  const applicationFolders = [
    "controllers",
    "middleware",
    "models",
    "routes",
    "services",
  ].map(folder =>
    path.join(projectRoot, folder) +
    path.sep
  );

  for (const cachedPath of Object.keys(
    require.cache
  )) {
    if (
      cachedPath ===
        path.join(projectRoot, "app.js") ||
      cachedPath ===
        path.join(projectRoot, "config", "env.js") ||
      applicationFolders.some(folder =>
        cachedPath.startsWith(folder)
      )
    ) {
      delete require.cache[cachedPath];
    }
  }
}

async function startTestApp() {
  clearApplicationModules();

  const cliente = makeClient();
  const passwordHash = await bcrypt.hash("password-test", 4);
  const user = {
    _id: "user-1", nombre: "Admin", usuario: "admin", rol: "administrador",
    passwordHash, activo: true, async save() {},
  };
  const mocks = {
    "config/env.js": testEnv,
    "models/Cliente.js": {
      findOneAndUpdate: async ({ numero }) => { cliente.numero = numero; return cliente; },
      findOne: async ({ numero }) => numero === cliente.numero ? cliente : null,
      find: () => queryResult([cliente]),
    },
    "models/Producto.js": {
      find: () => queryResult([{ _id: "507f1f77bcf86cd799439011", name: "Camarones", category: "Camarones", price: 180, type: "food", active: true }]),
    },
    "models/Combo.js": { find: () => queryResult([]) },
    "models/ProcessedMessage.js": { create: async () => ({}) },
    "models/Usuario.js": { findOne: async () => user },
    "services/whatsappService.js": {
      sendText: async () => ({ ok: true }), sendImage: async () => ({ ok: true }),
      sendButtons: async () => ({ ok: true }), sendList: async () => ({ ok: true }),
    },
  };
  const context = loadWithMocks("app.js", mocks);
  const app = context.loaded.createApp({ sessionStore: new session.MemoryStore() });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  return {
    cliente,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
      context.restore();
    },
  };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] || "";
}

test("aplicación Express atiende rutas públicas y webhook real", async t => {
  const fixture = await startTestApp();
  t.after(() => fixture.close());

  const verification = await fetch(`${fixture.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=abc`);
  assert.equal(verification.status, 200);
  assert.equal(await verification.text(), "abc");

  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
  const signature = `sha256=${crypto.createHmac("sha256", testEnv.APP_SECRET).update(body).digest("hex")}`;
  const webhook = await fetch(`${fixture.baseUrl}/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body,
  });
  assert.equal(webhook.status, 200);

  assert.equal((await fetch(`${fixture.baseUrl}/tienda`)).status, 200);
});

test("panel y sus APIs exigen sesión administrativa aunque PANEL_API_KEY esté vacío", async t => {
  const fixture = await startTestApp();
  t.after(() => fixture.close());

  const page = await fetch(`${fixture.baseUrl}/panel`, { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/admin/login");
  assert.equal((await fetch(`${fixture.baseUrl}/api/pedidos`)).status, 401);
  assert.equal((await fetch(`${fixture.baseUrl}/api/historial`)).status, 401);
  assert.equal((await fetch(`${fixture.baseUrl}/api/dashboard`)).status, 401);
  const adminPage = await fetch(
    `${fixture.baseUrl}/admin/productos`,
    { redirect: "manual" }
  );
  assert.equal(adminPage.status, 302);
  assert.equal(adminPage.headers.get("location"), "/admin/login");

  const login = await fetch(`${fixture.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ usuario: "admin", password: "password-test" }),
  });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  assert.ok(cookie);
  assert.equal((await fetch(`${fixture.baseUrl}/panel`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${fixture.baseUrl}/api/pedidos`, { headers: { cookie } })).status, 200);
  const stateChange = await fetch(
    `${fixture.baseUrl}/api/pedido/cocina`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        numero: fixture.cliente.numero,
      }),
    }
  );
  assert.equal(stateChange.status, 200);
  assert.equal(fixture.cliente.estadoPedido, "cocina");
});

test("checkout rechaza teléfono claramente inválido", async t => {
  const fixture = await startTestApp();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.baseUrl}/api/tienda/pedido`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ numero: "123", items: [{ id: "p0", cantidad: 1 }] }),
  });
  assert.equal(response.status, 400);
});

test("checkout limita solicitudes rápidas por dirección IP", async t => {
  const fixture = await startTestApp();
  t.after(() => fixture.close());
  const statuses = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`${fixture.baseUrl}/api/tienda/pedido`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ numero: "5512345678", items: [{ id: "p0", cantidad: 1 }] }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[5], 429);
});

test("JSON público mayor a 1 MB es rechazado", async t => {
  const fixture = await startTestApp();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.baseUrl}/api/tienda/pedido`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ numero: "5512345678", padding: "x".repeat(1024 * 1024 + 1), items: [] }),
  });
  assert.equal(response.status, 413);
});
