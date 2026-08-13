const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWithMocks } = require("../test-support/moduleMocks");

function serviceWithModel(model) {
  return loadWithMocks("services/messageService.js", {
    "models/ProcessedMessage.js": model,
  });
}

function duplicate(status, attempts = 1) {
  const error = Object.assign(new Error("duplicate"), { code: 11000 });
  return {
    findOneAndUpdate: async () => { throw error; },
    findOne: () => ({ lean: async () => ({ status, attempts }) }),
  };
}

test("mensaje nuevo se adquiere atómicamente como processing", async () => {
  let captured;
  const context = serviceWithModel({
    findOneAndUpdate: async (...args) => { captured = args; return { attempts: 1 }; },
  });
  const result = await context.loaded.acquireMessage("wamid.new");
  assert.equal(result.acquired, true);
  assert.equal(result.attempts, 1);
  assert.equal(captured[1].$set.status, "processing");
  assert.equal(captured[1].$inc.attempts, 1);
  assert.equal(captured[2].upsert, true);
  context.restore();
});

test("completed se rechaza como duplicado", async () => {
  const context = serviceWithModel(duplicate("completed", 1));
  assert.deepEqual(await context.loaded.acquireMessage("wamid.done"), {
    acquired: false, reason: "completed", attempts: 1,
  });
  context.restore();
});

test("failed puede reclamarse e incrementa attempts", async () => {
  const context = serviceWithModel({
    findOneAndUpdate: async () => ({ status: "processing", attempts: 2 }),
  });
  const result = await context.loaded.acquireMessage("wamid.failed");
  assert.equal(result.acquired, true);
  assert.equal(result.reclaimed, true);
  assert.equal(result.attempts, 2);
  context.restore();
});

test("processing con lease activo no se adquiere", async () => {
  const context = serviceWithModel(duplicate("processing", 1));
  const result = await context.loaded.acquireMessage("wamid.busy");
  assert.equal(result.acquired, false);
  assert.equal(result.reason, "processing");
  context.restore();
});

test("la adquisición permite reclamar processing con lease expirado", async () => {
  let filter;
  const now = new Date("2026-08-12T12:00:00Z");
  const context = serviceWithModel({
    findOneAndUpdate: async query => { filter = query; return { attempts: 2 }; },
  });
  const result = await context.loaded.acquireMessage("wamid.stale", { now });
  const staleClause = filter.$or.find(item => item.status === "processing");
  assert.deepEqual(staleClause.processingLeaseUntil, { $lte: now });
  assert.equal(result.reclaimed, true);
  context.restore();
});

test("éxito marca completed usando el token propietario", async () => {
  let captured;
  const context = serviceWithModel({
    findOneAndUpdate: async (...args) => { captured = args; return { status: "completed" }; },
  });
  await context.loaded.completeMessage("wamid.ok", "owner-token", new Date("2026-08-12"));
  assert.deepEqual(captured[0], {
    messageId: "wamid.ok", status: "processing", processingToken: "owner-token",
  });
  assert.equal(captured[1].$set.status, "completed");
  context.restore();
});

test("excepción marca failed y persiste error sanitizado", async () => {
  let captured;
  const context = serviceWithModel({
    findOneAndUpdate: async (...args) => { captured = args; return { status: "failed" }; },
  });
  const error = Object.assign(
    new Error(`Bearer secreto-superprivado ${"x".repeat(400)}`),
    { code: "ECONNRESET", config: { headers: { Authorization: "secret" } } }
  );
  await context.loaded.failMessage("wamid.fail", "owner", error);
  const stored = captured[1].$set.lastError;
  assert.equal(stored.code, "ECONNRESET");
  assert.ok(stored.message.length <= 300);
  assert.doesNotMatch(stored.message, /secreto-superprivado/);
  assert.equal(stored.config, undefined);
  context.restore();
});

test("dos adquisiciones concurrentes simuladas conceden solo una", async () => {
  let locked = false;
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  const model = {
    async findOneAndUpdate() {
      if (locked) throw duplicateError;
      locked = true;
      await new Promise(resolve => setImmediate(resolve));
      return { status: "processing", attempts: 1 };
    },
    findOne: () => ({ lean: async () => ({ status: "processing", attempts: 1 }) }),
  };
  const context = serviceWithModel(model);
  const results = await Promise.all([
    context.loaded.acquireMessage("wamid.race"),
    context.loaded.acquireMessage("wamid.race"),
  ]);
  assert.equal(results.filter(item => item.acquired).length, 1);
  assert.equal(results.filter(item => !item.acquired).length, 1);
  context.restore();
});

test("un token de lease antiguo no puede completar el intento nuevo", async () => {
  let filter;
  const context = serviceWithModel({
    findOneAndUpdate: async query => { filter = query; return null; },
  });
  const result = await context.loaded.completeMessage("wamid.stale-owner", "old-token");
  assert.equal(result, null);
  assert.equal(filter.processingToken, "old-token");
  context.restore();
});

test("ProcessedMessage conserva estados, attempts, lease y TTL", () => {
  const ProcessedMessage = require("../models/ProcessedMessage");
  assert.deepEqual(
    ProcessedMessage.schema.path("status").enumValues,
    ["received", "processing", "completed", "failed"]
  );
  assert.equal(ProcessedMessage.schema.path("attempts").options.default, 0);
  assert.ok(ProcessedMessage.schema.path("processingLeaseUntil"));
  assert.equal(ProcessedMessage.schema.path("createdAt").options.expires, "7d");
});

test("webhook completa un procesamiento exitoso", async () => {
  const completed = [];
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": { APP_SECRET: "test", VERIFY_TOKEN: "test" },
    "services/messageService.js": {
      acquireMessage: async () => ({ acquired: true, processingToken: "owner", attempts: 1 }),
      completeMessage: async (...args) => completed.push(args),
      failMessage: async () => {},
      getMessagesFromWebhook: () => [],
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": { handleIncoming: async () => {} },
    "services/webhookLogger.js": { logWebhookEvent: () => {} },
  });
  await context.loaded.processMessages([{ id: "wamid.success" }]);
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].slice(0, 2), ["wamid.success", "owner"]);
  context.restore();
});

test("webhook marca failed y el mismo messageId puede procesarse en el siguiente intento", async () => {
  let flowCalls = 0;
  const failed = [];
  const completed = [];
  let attempts = 0;
  const context = loadWithMocks("controllers/webhookController.js", {
    "config/env.js": { APP_SECRET: "test", VERIFY_TOKEN: "test" },
    "services/messageService.js": {
      acquireMessage: async () => {
        attempts += 1;
        return { acquired: true, processingToken: `owner-${attempts}`, attempts, reclaimed: attempts > 1 };
      },
      completeMessage: async (...args) => completed.push(args),
      failMessage: async (...args) => failed.push(args),
      getMessagesFromWebhook: () => [],
      sanitizeError: error => ({ name: error.name, code: "", message: error.message }),
    },
    "controllers/botFlowController.js": {
      handleIncoming: async () => {
        flowCalls += 1;
        if (flowCalls === 1) throw new Error("fallo transitorio");
      },
    },
    "services/webhookLogger.js": { logWebhookEvent: () => {} },
  });
  const message = { id: "wamid.retry" };
  await context.loaded.processMessages([message]);
  await context.loaded.processMessages([message]);
  assert.equal(failed.length, 1);
  assert.equal(completed.length, 1);
  assert.equal(flowCalls, 2);
  assert.equal(attempts, 2);
  context.restore();
});
