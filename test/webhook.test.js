const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");

const env = { VERIFY_TOKEN: "verify-test", APP_SECRET: "secret-test" };

function request({ query = {}, rawBody = Buffer.from(""), signature = "" } = {}) {
  return {
    query,
    rawBody,
    body: JSON.parse(rawBody.length ? rawBody.toString() : "{}"),
    get(name) {
      return name.toLowerCase() === "x-hub-signature-256" ? signature : "";
    },
  };
}

test("GET acepta token válido y devuelve challenge", () => {
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": env,
    "services/messageService.js": {
      getMessagesFromWebhook: () => [],
      acquireMessage: async () => ({ acquired: false, reason: "completed" }),
      completeMessage: async () => {}, failMessage: async () => {},
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": { handleIncoming: async () => {} },
  });
  const res = responseRecorder();
  context.loaded.verifyWebhook(request({ query: {
    "hub.mode": "subscribe", "hub.verify_token": "verify-test", "hub.challenge": "123",
  } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.sent, "123");
  context.restore();
});

test("GET rechaza token inválido", () => {
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": env,
    "services/messageService.js": {
      getMessagesFromWebhook: () => [],
      acquireMessage: async () => ({ acquired: false, reason: "completed" }),
      completeMessage: async () => {}, failMessage: async () => {},
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": { handleIncoming: async () => {} },
  });
  const res = responseRecorder();
  context.loaded.verifyWebhook(request({ query: {
    "hub.mode": "subscribe", "hub.verify_token": "incorrecto", "hub.challenge": "123",
  } }), res);
  assert.equal(res.statusCode, 403);
  context.restore();
});

test("POST con firma válida responde 200 y procesa el mensaje sin contactar Meta", async () => {
  const processed = [];
  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "5211", type: "text", text: { body: "hola" } }] } }] }] }));
  const signature = `sha256=${crypto.createHmac("sha256", env.APP_SECRET).update(body).digest("hex")}`;
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": env,
    "services/messageService.js": {
      getMessagesFromWebhook: value => value.entry[0].changes[0].value.messages,
      acquireMessage: async () => ({ acquired: true, processingToken: "token", attempts: 1 }),
      completeMessage: async () => {}, failMessage: async () => {},
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": { handleIncoming: async message => processed.push(message.id) },
  });
  const res = responseRecorder();
  context.loaded.receiveWebhook(request({ rawBody: body, signature }), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(processed, ["wamid.1"]);
  context.restore();
});

test("POST con firma inválida responde 401 y no procesa", async () => {
  let calls = 0;
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": env,
    "services/messageService.js": {
      getMessagesFromWebhook: () => [],
      acquireMessage: async () => ({ acquired: false, reason: "completed" }),
      completeMessage: async () => {}, failMessage: async () => {},
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": { handleIncoming: async () => { calls += 1; } },
  });
  const res = responseRecorder();
  context.loaded.receiveWebhook(request({ rawBody: body, signature: "sha256=invalid" }), res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
  context.restore();
});

test("deduplicación identifica un messageId ya registrado", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  let calls = 0;
  const context = loadWithMocks("services/messageService.js", {
    "models/ProcessedMessage.js": { create: async () => { calls += 1; if (calls > 1) throw duplicateError; } },
  });
  assert.equal(await context.loaded.alreadyProcessed("wamid.same"), false);
  assert.equal(await context.loaded.alreadyProcessed("wamid.same"), true);
  context.restore();
});
