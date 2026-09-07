const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { loadWithMocks, responseRecorder } = require("../test-support/moduleMocks");
const TenantMembership = require("../models/TenantMembership");

function leanResult(value) {
  return { lean: async () => value };
}

function membershipListResult(value) {
  return {
    populate() { return this; },
    async lean() { return value; },
  };
}

test("TenantMembership declara relaciones, roles y unicidad por usuario+tenant", () => {
  const membership = new TenantMembership({
    userId: new mongoose.Types.ObjectId(),
    tenantId: new mongoose.Types.ObjectId(),
    role: "owner",
  });
  assert.equal(membership.validateSync(), undefined);
  assert.equal(membership.active, true);
  assert.equal(TenantMembership.schema.path("userId").options.ref, "Usuario");
  assert.equal(TenantMembership.schema.path("tenantId").options.ref, "Tenant");
  assert.ok(TenantMembership.schema.indexes().some(([keys, options]) =>
    keys.userId === 1 && keys.tenantId === 1 && options.unique
  ));
  membership.role = "superadmin";
  assert.ok(membership.validateSync().errors.role);
});

test("selección de login distingue cero, uno y múltiples memberships", async () => {
  for (const [memberships, expected] of [
    [[], "no_active_membership"],
    [[{ _id: "m1", tenantId: { _id: "t1" }, role: "owner" }], "selected"],
    [[{ _id: "m1", tenantId: { _id: "t1" } }, { _id: "m2", tenantId: { _id: "t2" } }], "tenant_selection_required"],
  ]) {
    const context = loadWithMocks("services/tenantMembershipService.js", {
      "models/TenantMembership.js": { find: () => membershipListResult(memberships) },
    });
    const result = await context.loaded.selectMembershipForLogin("user-a");
    assert.equal(result.selected ? "selected" : result.reason, expected);
    context.restore();
  }
});

async function resolveFixture({ membership = {}, tenant = {}, bodyTenantId } = {}) {
  const userId = "507f1f77bcf86cd799439011";
  const tenantId = "507f1f77bcf86cd799439012";
  const membershipId = "507f1f77bcf86cd799439013";
  let observedMembershipQuery;
  const context = loadWithMocks("middleware/tenantContext.js", {
    "models/Usuario.js": { findOne: () => leanResult({ _id: userId, activo: true }) },
    "models/TenantMembership.js": {
      findOne: query => {
        observedMembershipQuery = query;
        return leanResult(membership === null ? null : {
          _id: membershipId, userId, tenantId, role: "owner", active: true, ...membership,
        });
      },
    },
    "models/Tenant.js": {
      findById: () => leanResult(tenant === null ? null : {
        _id: tenantId, name: "Tenant A", slug: "tenant-a", status: "active", ...tenant,
      }),
    },
  });
  const req = {
    session: {
      usuario: { id: userId },
      tenantContext: { tenantId, membershipId, role: "owner" },
    },
    body: bodyTenantId ? { tenantId: bodyTenantId } : {},
    query: bodyTenantId ? { tenantId: bodyTenantId } : {},
  };
  const result = await context.loaded.resolveTenantContextFromSession(req);
  context.restore();
  return { result, req, tenantId, observedMembershipQuery };
}

test("usuario con membership activo construye contexto exclusivamente para su tenant", async () => {
  const { result, tenantId } = await resolveFixture();
  assert.equal(result.resolved, true);
  assert.equal(String(result.tenantId), tenantId);
});

test("tenantId arbitrario en body o query no altera el tenant de sesión", async () => {
  const requested = "507f1f77bcf86cd799439099";
  const { result, tenantId, observedMembershipQuery } =
    await resolveFixture({ bodyTenantId: requested });
  assert.equal(String(result.tenantId), tenantId);
  assert.notEqual(String(result.tenantId), requested);
  assert.equal(String(observedMembershipQuery.tenantId), tenantId);
});

test("usuario sin membership hacia el tenant solicitado no construye contexto", async () => {
  const { result } = await resolveFixture({ membership: null });
  assert.deepEqual(result, { resolved: false, reason: "membership_invalid" });
});

test("membership inactivo se rechaza al exigir active true en la consulta", async () => {
  const { result, observedMembershipQuery } =
    await resolveFixture({ membership: null });
  assert.equal(result.reason, "membership_invalid");
  assert.equal(observedMembershipQuery.active, true);
});

test("tenant suspendido o cancelado se rechaza", async () => {
  for (const status of ["suspended", "cancelled"]) {
    const { result } = await resolveFixture({ tenant: { status } });
    assert.equal(result.resolved, false);
    assert.equal(result.reason, `tenant_${status}`);
  }
});

test("tenant onboarding puede acceder para completar su configuración", async () => {
  const { result } = await resolveFixture({ tenant: { status: "onboarding" } });
  assert.equal(result.resolved, true);
});

test("middleware de rol rechaza staff y permite owner", () => {
  const { requireTenantRole } = require("../middleware/requireAdmin");
  const middleware = requireTenantRole("owner", "administrator");
  const denied = responseRecorder();
  middleware({ tenantMembership: { role: "staff" } }, denied, () => assert.fail());
  assert.equal(denied.statusCode, 403);

  let allowed = 0;
  middleware({ tenantMembership: { role: "owner" } }, responseRecorder(), () => { allowed += 1; });
  assert.equal(allowed, 1);
});

test("bootstrap legacy asegura membership owner activo mediante upsert estable", async () => {
  const calls = [];
  const context = loadWithMocks("services/legacyTenantService.js", {
    "models/TenantMembership.js": {
      findOneAndUpdate: async (...args) => { calls.push(args); return { _id: "m1" }; },
    },
  });
  const user = { _id: new mongoose.Types.ObjectId() };
  const tenant = { _id: new mongoose.Types.ObjectId() };
  await context.loaded.ensureLegacyMembership(user, tenant);
  await context.loaded.ensureLegacyMembership(user, tenant);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][0], { userId: user._id, tenantId: tenant._id });
  assert.deepEqual(calls[0][1].$set, { active: true });
  assert.equal(calls[0][1].$setOnInsert.role, "owner");
  assert.equal(calls[0][2].upsert, true);
  assert.deepEqual(calls[0][0], calls[1][0]);
  context.restore();
});

test("bootstrap legacy conserva el orden exacto de operaciones", async () => {
  const calls = [];
  const tenant = { _id: "tenant-1" };
  const branch = { _id: "branch-1" };
  const admin = { _id: "user-1" };
  const context = loadWithMocks("services/legacyStartupBootstrapService.js", {
    "controllers/authController.js": {
      createInitialAdmin: async () => { calls.push("admin"); return admin; },
    },
    "services/categorySyncService.js": {
      syncLegacyCategories: async () => { calls.push("categories"); },
    },
    "services/productSyncService.js": {
      syncLegacyProducts: async () => { calls.push("products"); },
    },
    "services/catalogBackfillService.js": {
      backfillLegacyCatalogTenant: async received => {
        assert.equal(received, tenant); calls.push("backfill");
      },
    },
    "services/customerBackfillService.js": {
      backfillLegacyCustomers: async received => {
        assert.equal(received, tenant); calls.push("customers");
      },
    },
    "services/legacyTenantService.js": {
      ensureLegacyTenant: async () => { calls.push("tenant"); return tenant; },
      ensureLegacyBranch: async received => {
        assert.equal(received, tenant); calls.push("branch"); return branch;
      },
      ensureLegacyMembership: async (receivedUser, receivedTenant) => {
        assert.equal(receivedUser, admin); assert.equal(receivedTenant, tenant);
        calls.push("membership");
      },
      ensureLegacyWhatsAppChannel: async (receivedTenant, receivedBranch) => {
        assert.equal(receivedTenant, tenant); assert.equal(receivedBranch, branch);
        calls.push("channel");
      },
    },
  });
  await context.loaded.runLegacyStartupBootstrap({
    phoneNumberId: "phone-1",
    whatsappBusinessAccountId: "",
    displayPhoneNumber: "",
  });
  assert.deepEqual(calls, [
    "tenant", "branch", "admin", "membership", "channel",
    "backfill", "customers", "categories", "products",
  ]);
  context.restore();
});

test("flag legacy ausente o false no ejecuta bootstrap y true sí lo habilita", () => {
  const context = loadWithMocks("services/legacyStartupBootstrapService.js", {});
  assert.equal(context.loaded.shouldRunLegacyStartupBootstrap(undefined), false);
  assert.equal(context.loaded.shouldRunLegacyStartupBootstrap(""), false);
  assert.equal(context.loaded.shouldRunLegacyStartupBootstrap("false"), false);
  assert.equal(context.loaded.shouldRunLegacyStartupBootstrap("TRUE"), false);
  assert.equal(context.loaded.shouldRunLegacyStartupBootstrap("true"), true);
  context.restore();
});

test("arranque normal sin flag sólo construye, conecta y escucha", async () => {
  for (const flag of [undefined, "false"]) {
    const calls = [];
    const previousFlag = process.env.LEGACY_STARTUP_BOOTSTRAP;
    if (flag === undefined) delete process.env.LEGACY_STARTUP_BOOTSTRAP;
    else process.env.LEGACY_STARTUP_BOOTSTRAP = flag;

    const context = loadWithMocks("server.js", {
      "config/env.js": { MONGO_URI: "mongodb://test.invalid/test", PORT: 0 },
      "app.js": {
        createApp: () => {
          calls.push("app");
          return { listen: (_port, callback) => { calls.push("listen"); callback(); } };
        },
      },
      "services/legacyStartupBootstrapService.js": {
        shouldRunLegacyStartupBootstrap: value => value === "true",
        runLegacyStartupBootstrap: async () => { calls.push("legacy"); },
      },
      "node_modules/mongoose/index.js": {
        connect: async () => { calls.push("mongo"); },
      },
    });

    await context.loaded.startServer();
    assert.deepEqual(calls, ["app", "mongo", "listen"]);
    context.restore();
    if (previousFlag === undefined) delete process.env.LEGACY_STARTUP_BOOTSTRAP;
    else process.env.LEGACY_STARTUP_BOOTSTRAP = previousFlag;
  }
});

test("fallo del bootstrap legacy detiene la cadena", async () => {
  const calls = [];
  const context = loadWithMocks("services/legacyStartupBootstrapService.js", {});
  await assert.rejects(
    () => context.loaded.runLegacyStartupBootstrap({
      ensureTenant: async () => { calls.push("tenant"); throw new Error("legacy failure"); },
      ensureBranch: async () => { calls.push("branch"); },
      createAdmin: async () => { calls.push("admin"); },
    }),
    /legacy failure/
  );
  assert.deepEqual(calls, ["tenant"]);
  context.restore();
});
