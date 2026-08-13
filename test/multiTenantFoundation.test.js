const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");
const Tenant = require("../models/Tenant");
const Branch = require("../models/Branch");
const WhatsAppChannel = require("../models/WhatsAppChannel");

test("Tenant valida slug y aplica defaults regionales", () => {
  const tenant = new Tenant({ name: " Marisco Alegre ", slug: "Marisco-Alegre" });
  assert.equal(tenant.validateSync(), undefined);
  assert.equal(tenant.name, "Marisco Alegre");
  assert.equal(tenant.slug, "marisco-alegre");
  assert.equal(tenant.status, "active");
  assert.equal(tenant.timezone, "America/Mexico_City");
  assert.equal(tenant.currency, "MXN");
  assert.ok(new Tenant({ name: "X", slug: "slug inseguro!" }).validateSync().errors.slug);
  assert.equal(Tenant.schema.path("slug").options.unique, true);
});

test("Branch pertenece a Tenant y slug es único solo dentro del tenant", () => {
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  assert.equal(new Branch({ tenantId: tenantA, name: "Centro", slug: "centro" }).validateSync(), undefined);
  assert.equal(new Branch({ tenantId: tenantB, name: "Centro", slug: "centro" }).validateSync(), undefined);
  assert.equal(Branch.schema.path("tenantId").options.ref, "Tenant");
  assert.ok(Branch.schema.indexes().some(([keys, options]) =>
    keys.tenantId === 1 && keys.slug === 1 && options.unique
  ));
  assert.equal(Branch.schema.path("slug").options.unique, undefined);
});

test("WhatsAppChannel pertenece a Tenant y provider+phoneNumberId es único", () => {
  const channel = new WhatsAppChannel({
    tenantId: new mongoose.Types.ObjectId(),
    branchId: new mongoose.Types.ObjectId(),
    phoneNumberId: "phone-1",
  });
  assert.equal(channel.validateSync(), undefined);
  assert.equal(channel.provider, "meta");
  assert.equal(WhatsAppChannel.schema.path("tenantId").options.ref, "Tenant");
  assert.equal(WhatsAppChannel.schema.path("branchId").options.ref, "Branch");
  assert.ok(WhatsAppChannel.schema.indexes().some(([keys, options]) =>
    keys.provider === 1 && keys.phoneNumberId === 1 && options.unique
  ));
  assert.equal(WhatsAppChannel.schema.path("accessToken"), undefined);
});

test("bootstrap legacy usa upserts y omite canal sin PHONE_NUMBER_ID", async () => {
  const tenant = { _id: new mongoose.Types.ObjectId() };
  const branch = { _id: new mongoose.Types.ObjectId() };
  const calls = [];
  const context = loadWithMocks("services/legacyTenantService.js", {
    "models/Tenant.js": { findOneAndUpdate: async (...args) => { calls.push(["tenant", ...args]); return tenant; } },
    "models/Branch.js": { findOneAndUpdate: async (...args) => { calls.push(["branch", ...args]); return branch; } },
    "models/WhatsAppChannel.js": { findOneAndUpdate: async (...args) => { calls.push(["channel", ...args]); return {}; } },
  });
  const result = await context.loaded.ensureLegacyBusiness({});
  assert.equal(result.whatsappChannel, null);
  assert.equal(calls.filter(item => item[0] === "channel").length, 0);
  assert.equal(calls[0][3].upsert, true);
  assert.equal(calls[1][3].upsert, true);
  context.restore();
});

test("bootstrap asocia PHONE_NUMBER_ID al tenant y branch legacy", async () => {
  const tenant = { _id: new mongoose.Types.ObjectId() };
  const branch = { _id: new mongoose.Types.ObjectId() };
  let channelCall;
  const context = loadWithMocks("services/legacyTenantService.js", {
    "models/Tenant.js": { findOneAndUpdate: async () => tenant },
    "models/Branch.js": { findOneAndUpdate: async () => branch },
    "models/WhatsAppChannel.js": { findOneAndUpdate: async (...args) => { channelCall = args; return {}; } },
  });
  await context.loaded.ensureLegacyBusiness({ phoneNumberId: "meta-phone-id" });
  assert.deepEqual(channelCall[0], { provider: "meta", phoneNumberId: "meta-phone-id" });
  assert.equal(String(channelCall[1].$setOnInsert.tenantId), String(tenant._id));
  assert.equal(String(channelCall[1].$setOnInsert.branchId), String(branch._id));
  assert.equal(channelCall[2].upsert, true);
  context.restore();
});

test("resolvedor distingue canal activo, inexistente e inactivo sin fallback", async () => {
  const tenantId = new mongoose.Types.ObjectId();
  const active = loadWithMocks("services/tenantResolverService.js", {
    "models/WhatsAppChannel.js": { findOne: () => ({ lean: async () => ({ _id: "c1", tenantId, active: true }) }) },
  });
  assert.equal((await active.loaded.resolveTenantFromPhoneNumberId("known")).resolved, true);
  active.restore();
  const missing = loadWithMocks("services/tenantResolverService.js", {
    "models/WhatsAppChannel.js": { findOne: () => ({ lean: async () => null }) },
  });
  assert.deepEqual(await missing.loaded.resolveTenantFromPhoneNumberId("unknown"), {
    resolved: false, reason: "channel_not_found",
  });
  missing.restore();
  const inactive = loadWithMocks("services/tenantResolverService.js", {
    "models/WhatsAppChannel.js": { findOne: () => ({ lean: async () => ({ _id: "c2", tenantId, active: false }) }) },
  });
  assert.equal((await inactive.loaded.resolveTenantFromPhoneNumberId("disabled")).reason, "channel_inactive");
  inactive.restore();
});

test("contexto ignora tenantId arbitrario y usa resolvedor confiable", async () => {
  const trusted = new mongoose.Types.ObjectId();
  const untrusted = new mongoose.Types.ObjectId();
  const { tenantContextFromTrustedResolver } = require("../middleware/tenantContext");
  const middleware = tenantContextFromTrustedResolver(async () => ({ tenantId: trusted }));
  const req = { body: { tenantId: untrusted } };
  const res = responseRecorder();
  let calls = 0;
  await middleware(req, res, () => { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(String(req.tenantId), String(trusted));
  assert.notEqual(String(req.tenantId), String(req.body.tenantId));
});
