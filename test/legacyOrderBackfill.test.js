const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUIRED_CONFIRMATION,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  LEGACY_STATUS_MAP,
  RECORD_STATUS,
  backfillLegacyOrders,
  normalizeBatchSize,
  convertLegacyEntry,
  generateStableId,
  normalizeItems,
  buildLegacyLookupQuery,
  chooseOrderNumber,
} = require("../services/legacyOrderBackfillService");

// ============================================================================
// TEST FIXTURES
// ============================================================================

function historialEntry(overrides = {}) {
  return {
    _id: "entry-1",
    fecha: new Date("2025-01-02T10:00:00Z"),
    estadoFinal: "entregado",
    pedidos: [
      {
        productId: "507f1f77bcf86cd799439011",
        nombre: "Camarones",
        precio: 180,
        cantidad: 2,
      },
    ],
    total: 360,
    nombre: "Ana García",
    numero: "5215512345678",
    direccion: { calle: "Privada", número: "123" },
    motivoCancelacion: "",
    ...overrides,
  };
}

function cliente(overrides = {}) {
  return {
    _id: "customer-a",
    tenantId: "tenant-a",
    branchId: "branch-a",
    historialPedidos: [historialEntry()],
    ...overrides,
  };
}

function backfillFixture({
  customers = [cliente()],
  existingOrders = [],
  orderNumberCollisions = [],
} = {}) {
  const created = [];
  const queries = [];
  const logs = [];

  const Cliente = {
    find() {
      return {
        select() {
          return this;
        },
        lean() {
          return this;
        },
        cursor({ batchSize }) {
          Cliente.batchSizeUsed = batchSize;
          return {
            async *[Symbol.asyncIterator]() {
              for (const value of customers) {
                yield value;
              }
            },
          };
        },
      };
    },
  };

  const Order = {
    async findOne(query) {
      queries.push(query);

      // Búsqueda por legacySource (check idempotencia)
      if (query["legacySource.type"]) {
        return existingOrders.find(
          (order) =>
            order.tenantId === query.tenantId &&
            order.legacySource.customerId === query["legacySource.customerId"] &&
            order.legacySource.legacyEntryId ===
              query["legacySource.legacyEntryId"]
        ) || null;
      }

      // Búsqueda por orderNumber (check colisión)
      if (query.orderNumber) {
        return orderNumberCollisions.find(
          (order) =>
            order.tenantId === query.tenantId &&
            order.orderNumber === query.orderNumber
        ) || null;
      }

      return null;
    },
    async create(orderData) {
      created.push(orderData);
      return orderData;
    },
  };

  return {
    Cliente,
    Order,
    created,
    queries,
    logs,
    logger: (value) => logs.push(value),
  };
}

// ============================================================================
// 1. DRY-RUN NO ESCRIBE
// ============================================================================

test("DRY-RUN: analiza sin crear Orders", async () => {
  const original = cliente();
  const before = JSON.stringify(original);

  const fixture = backfillFixture({ customers: [original] });
  const result = await backfillLegacyOrders({
    ...fixture,
    apply: false,
  });

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.ready, 1);
  assert.deepEqual(fixture.created, []);
  assert.equal(JSON.stringify(original), before);
});

// ============================================================================
// 2. CLIENTE SIN TENANT -> BLOCKED
// ============================================================================

test("BLOQUEADO: Cliente sin tenantId", async () => {
  const fixture = backfillFixture({
    customers: [cliente({ tenantId: null })],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
  assert.equal(result.ready, 0);
});

test("BLOQUEADO: Cliente sin _id", async () => {
  const fixture = backfillFixture({
    customers: [cliente({ _id: null })],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
});

// ============================================================================
// 3. AISLAMIENTO MULTI-TENANT
// ============================================================================

test("AISLAMIENTO: Tenants A y B con mismos datos se segregan", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({ _id: "cust-a", tenantId: "tenant-a" }),
      cliente({
        _id: "cust-b",
        tenantId: "tenant-b",
        historialPedidos: [
          historialEntry({ _id: "entry-b", nombre: "Bob" }),
        ],
      }),
    ],
  });

  const result = await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  assert.equal(result.migrated, 2);
  assert.deepEqual(
    fixture.created.map((o) => o.tenantId),
    ["tenant-a", "tenant-b"]
  );
  assert.deepEqual(
    fixture.created.map((o) => o.customerId),
    ["cust-a", "cust-b"]
  );
  assert.deepEqual(
    fixture.created.map((o) => o.customerSnapshot.name),
    ["Ana García", "Bob"]
  );
});

test("AISLAMIENTO: stableId es único por customer (mismo orden data con clientes diferentes)", async () => {
  const entry = historialEntry();
  const fixture = backfillFixture({
    customers: [
      cliente({
        _id: "cust-a",
        tenantId: "tenant-a",
        historialPedidos: [entry],
      }),
      cliente({
        _id: "cust-b",
        tenantId: "tenant-b",
        historialPedidos: [entry],
      }),
    ],
  });

  const result = await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  // Ambos deben crearse sin colisión
  assert.equal(result.migrated, 2);
  assert.equal(result.blocked, 0);

  // stableId es DIFERENTE porque pertenecen a clientes diferentes
  // La stableId incluye customerId en su hash determinista
  const stableIds = fixture.created.map((o) => o.legacySource.legacyEntryId);
  assert.notEqual(stableIds[0], stableIds[1]);

  // Pero ambos tienen el mismo orderData de la entrada legacy
  assert.equal(fixture.created[0].items[0].name, fixture.created[1].items[0].name);
});

// ============================================================================
// 4. MAPEO DE ESTADOS LEGACY
// ============================================================================

test("ESTADOS: entregado -> completed", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ estadoFinal: "entregado" })],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  assert.equal(fixture.created[0].status, "completed");
  assert.equal(fixture.created[0].legacyStatus, "entregado");
});

test("ESTADOS: cancelado -> cancelled", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ estadoFinal: "cancelado" })],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  assert.equal(fixture.created[0].status, "cancelled");
  assert.equal(fixture.created[0].legacyStatus, "cancelado");
});

test("BLOQUEADO: Estado no terminal (cocina)", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ estadoFinal: "cocina" })],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
  assert.equal(result.ready, 0);
});

test("BLOQUEADO: Estado desconocido", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ estadoFinal: "perdido" })],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
});

// ============================================================================
// 5. NORMALIZACIÓN DE ITEMS
// ============================================================================

test("ITEMS: Normalización correcta de cantidad y precio", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            pedidos: [
              { nombre: "Camarones", precio: 180, cantidad: 2 },
              { nombre: "Pulpo", precio: 250, cantidad: 1 },
            ],
            total: 610,
          }),
        ],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].name, "Camarones");
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].unitPrice, 180);
  assert.equal(order.items[0].lineTotal, 360);
  assert.equal(order.items[1].quantity, 1);
  assert.equal(order.items[1].unitPrice, 250);
  assert.equal(order.items[1].lineTotal, 250);
});

test("BLOQUEADO: Items vacío", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ pedidos: [] })],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
});

test("BLOQUEADO: Item con nombre vacío", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            pedidos: [{ nombre: "", precio: 100, cantidad: 1 }],
          }),
        ],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
});

test("BLOQUEADO: Item con cantidad inválida", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            pedidos: [{ nombre: "Camarones", precio: 100, cantidad: 0 }],
          }),
        ],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.blocked, 1);
});

// ============================================================================
// 6. IDEMPOTENCIA
// ============================================================================

test("IDEMPOTENCIA: Order ya migrado no se duplica", async () => {
  const entry = historialEntry();
  const stableId = generateStableId("customer-a", entry);

  const existingOrder = {
    tenantId: "tenant-a",
    customerId: "customer-a",
    legacySource: {
      type: "cliente_historial",
      customerId: "customer-a",
      legacyEntryId: stableId,
    },
  };

  const fixture = backfillFixture({
    customers: [cliente({ historialPedidos: [entry] })],
    existingOrders: [existingOrder],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.alreadyMigrated, 1);
  assert.deepEqual(fixture.created, []);
});

test("IDEMPOTENCIA: stableId es determinista", () => {
  const entry = historialEntry();
  const id1 = generateStableId("customer-a", entry);
  const id2 = generateStableId("customer-a", entry);

  assert.equal(id1, id2);
});

test("IDEMPOTENCIA: Cambio menor en item genera stableId diferente", () => {
  const entry1 = historialEntry({
    pedidos: [{ nombre: "Camarones", precio: 180, cantidad: 2 }],
  });
  const entry2 = historialEntry({
    pedidos: [{ nombre: "Camarones", precio: 180, cantidad: 3 }],
  });

  const id1 = generateStableId("customer-a", entry1);
  const id2 = generateStableId("customer-a", entry2);

  assert.notEqual(id1, id2);
});

// ============================================================================
// 7. PRESERVACIÓN DE DATOS HISTÓRICOS
// ============================================================================

test("DATOS: Timestamps preservados", async () => {
  const originalDate = new Date("2024-06-15T14:30:00Z");
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ fecha: originalDate })],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.createdAt.getTime(), originalDate.getTime());
  assert.equal(order.statusHistory[0].at.getTime(), originalDate.getTime());
});

test("DATOS: Dirección preservada", async () => {
  const address = { calle: "Privada", número: "123", ciudad: "CDMX" };
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ direccion: address })],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.deepEqual(order.fulfillment.address, address);
  assert.equal(order.fulfillment.type, "delivery");
});

test("DATOS: Sin dirección -> fulfillment none", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [historialEntry({ direccion: null })],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.fulfillment.type, "none");
  assert.equal(order.fulfillment.address, null);
});

// ============================================================================
// 8. TOTALES Y CÁLCULOS
// ============================================================================

test("TOTALES: Subtotal calculado correctamente", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            pedidos: [
              { nombre: "Camarones", precio: 180, cantidad: 2 },
              { nombre: "Pulpo", precio: 250, cantidad: 1 },
            ],
            total: 610,
          }),
        ],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.subtotal, 610);
  assert.equal(order.total, 610);
});

test("TOTALES: Total legacy se preserva si es válido", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            pedidos: [{ nombre: "Camarones", precio: 180, cantidad: 2 }],
            total: 400, // Diferente (ej: con descuento)
          }),
        ],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.total, 400);
});

// ============================================================================
// 9. CONFIRMACIÓN OBLIGATORIA
// ============================================================================

test("APPLY: Requiere confirmación exacta", async () => {
  const fixture = backfillFixture();

  await assert.rejects(
    () =>
      backfillLegacyOrders({
        ...fixture,
        apply: true,
        confirmation: "WRONG_CONFIRMATION",
      }),
    /Confirmación requerida/
  );
});

test("APPLY: Acepta confirmación correcta", async () => {
  const fixture = backfillFixture();

  const result = await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  assert.equal(result.mode, "APPLY");
});

// ============================================================================
// 10. PROCESAMIENTO POR LOTES
// ============================================================================

test("LOTES: Reseta batch size a MAX si excede", () => {
  assert.throws(
    () => normalizeBatchSize(MAX_BATCH_SIZE + 1),
    /batch-size debe ser/
  );
});

test("LOTES: Acepta batch size dentro de rango", () => {
  const size = normalizeBatchSize(250);
  assert.equal(size, 250);
});

test("LOTES: Usa batch size especificado", async () => {
  const fixture = backfillFixture();

  await backfillLegacyOrders({
    ...fixture,
    apply: false,
    batchSize: 75,
  });

  assert.equal(fixture.Cliente.batchSizeUsed, 75);
});

// ============================================================================
// 11. LOGGING SIN PII
// ============================================================================

test("LOGGING: No registra teléfono completo en logs", async () => {
  const fixture = backfillFixture();

  await backfillLegacyOrders({ ...fixture });

  const logContent = JSON.stringify(fixture.logs);
  // No debe contener números de teléfono completos
  assert.equal(logContent.includes("5215512345678"), false);
});

test("LOGGING: Incluye tenantId y customerId en logs", async () => {
  const fixture = backfillFixture();

  await backfillLegacyOrders({ ...fixture });

  const log = fixture.logs[0];
  assert.ok(log.tenantId);
  assert.ok(log.customerId);
});

// ============================================================================
// 12. ERRORES NO BLOQUEAN MIGRACIÓN COMPLETA
// ============================================================================

test("ERRORES: Error en un registro no detiene los demás", async () => {
  const clients = [
    cliente({ _id: "valid-1", tenantId: "tenant-a" }),
    cliente({ _id: "invalid-1", tenantId: null }), // Bloqueado
    cliente({ _id: "valid-2", tenantId: "tenant-a" }),
  ];

  const fixture = backfillFixture({ customers: clients });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.scannedCustomers, 3);
  assert.equal(result.scannedEntries, 3);
  assert.equal(result.ready, 2);
  assert.equal(result.blocked, 1);
});

// ============================================================================
// 13. RESUMEN Y CONTADORES
// ============================================================================

test("RESUMEN: Contadores por tenant", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        _id: "cust-a",
        tenantId: "tenant-a",
        historialPedidos: [
          historialEntry({ _id: "entry-1" }),
          historialEntry({ _id: "entry-2", estadoFinal: "cancelado" }),
        ],
      }),
      cliente({
        _id: "cust-b",
        tenantId: "tenant-b",
        historialPedidos: [historialEntry({ _id: "entry-3" })],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.ok(result.byTenant["tenant-a"]);
  assert.ok(result.byTenant["tenant-b"]);
  assert.equal(result.byTenant["tenant-a"].scannedEntries, 2);
  assert.equal(result.byTenant["tenant-b"].scannedEntries, 1);
});

// ============================================================================
// 14. SIN MODIFICACIONES AL CLIENTE
// ============================================================================

test("SEGURIDAD: Cliente.historialPedidos no se modifica", async () => {
  const original = cliente();
  const beforeHistorial = JSON.stringify(original.historialPedidos);

  const fixture = backfillFixture({ customers: [original] });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  assert.equal(JSON.stringify(original.historialPedidos), beforeHistorial);
});

// ============================================================================
// 15. ORDER NUMBER STRATEGY
// ============================================================================

test("ORDER_NUMBER: Basado en stableId sin colisión", async () => {
  const fixture = backfillFixture();

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.ok(order.orderNumber.startsWith("LEGACY-"));
  assert.ok(order.orderNumber.length <= 100);
});

test("ORDER_NUMBER: Fallback si stableId colisiona", async () => {
  const entry = historialEntry();
  const stableId = generateStableId("customer-a", entry);
  const orderNumber1 = `LEGACY-${stableId.slice(0, 24).toUpperCase()}`;

  const fixture = backfillFixture({
    customers: [cliente({ historialPedidos: [entry] })],
    orderNumberCollisions: [
      {
        tenantId: "tenant-a",
        orderNumber: orderNumber1,
      },
    ],
  });

  const result = await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  // Debe generar un orderNumber alternativo
  assert.equal(result.migrated, 1);
  const createdOrder = fixture.created[0];
  assert.notEqual(createdOrder.orderNumber, orderNumber1);
});

// ============================================================================
// 16. LEGACY SOURCE METADATA
// ============================================================================

test("METADATA: legacySource.type es cliente_historial", async () => {
  const fixture = backfillFixture();

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.legacySource.type, "cliente_historial");
  assert.equal(order.legacySource.customerId, "customer-a");
  assert.ok(order.legacySource.legacyEntryId);
});

// ============================================================================
// 17. LOOKUP QUERY CORRECTITUD
// ============================================================================

test("LOOKUP: buildLegacyLookupQuery genera query correcta", () => {
  const query = buildLegacyLookupQuery("tenant-a", "cust-a", "stable-id-123");

  assert.equal(query.tenantId, "tenant-a");
  assert.equal(query["legacySource.type"], "cliente_historial");
  assert.equal(query["legacySource.customerId"], "cust-a");
  assert.equal(query["legacySource.legacyEntryId"], "stable-id-123");
});

// ============================================================================
// 18. CUSTOMER SNAPSHOT
// ============================================================================

test("SNAPSHOT: Nombre y teléfono se preservan en customerSnapshot", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            nombre: "Ana María García López",
            numero: "5215512345678",
          }),
        ],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.customerSnapshot.name, "Ana María García López");
  assert.equal(order.customerSnapshot.phone, "5215512345678");
});

// ============================================================================
// 19. CONVERSIÓN FUNCTION UNIT TESTS
// ============================================================================

test("convertLegacyEntry: READY para entrada válida", () => {
  const result = convertLegacyEntry(cliente(), historialEntry());

  assert.equal(result.status, RECORD_STATUS.READY);
  assert.ok(result.stableId);
  assert.ok(result.orderData);
});

test("convertLegacyEntry: BLOCKED para tenant nulo", () => {
  const result = convertLegacyEntry(
    cliente({ tenantId: null }),
    historialEntry()
  );

  assert.equal(result.status, RECORD_STATUS.BLOCKED);
  assert.equal(result.reason, "missing_tenant_id");
});

// FALLBACK: Legacy entries sin estadoFinal pero con fecha y pedidos
test("convertLegacyEntry: BLOCKED cuando falta estadoFinal aunque existan fecha y pedidos válidos", () => {
  const entry = {
    fecha: new Date("2024-01-15"),
    pedidos: [
      {
        nombre: "Ceviche",
        precio: 150,
        cantidad: 1,
      },
    ],
    total: 150,
    nombre: "Cliente Antiguo",
    // Intencionalmente NO tiene estadoFinal.
  };

  const result = convertLegacyEntry(cliente(), entry);

  assert.equal(result.status, RECORD_STATUS.BLOCKED);
  assert.equal(result.reason, "invalid_status_undefined");

  // Seguridad histórica: una entrada sin estadoFinal no debe producir un Order.
  assert.equal(result.orderData, undefined);
});

test("SEGURIDAD: nunca infiere entregado/completed cuando estadoFinal está ausente", () => {
  const entry = {
    fecha: new Date("2024-01-15T10:00:00Z"),
    pedidos: [
      {
        nombre: "Camarones",
        precio: 180,
        cantidad: 2,
      },
    ],
    total: 360,
    nombre: "Cliente Legacy",
  };

  const result = convertLegacyEntry(cliente(), entry);

  assert.equal(result.status, RECORD_STATUS.BLOCKED);
  assert.notEqual(result.orderData?.status, "completed");
  assert.notEqual(result.orderData?.legacyStatus, "entregado");
  assert.notEqual(
    result.orderData?.metadata?.usedStatusFallback,
    true
  );
});

test("convertLegacyEntry: BLOCKED cuando no hay estadoFinal NI fecha/pedidos", () => {
  const entry = {
    nombre: "Cliente",
    // completamente vacío de datos
  };

  const result = convertLegacyEntry(cliente(), entry);

  assert.equal(result.status, RECORD_STATUS.BLOCKED);
  assert.equal(result.reason, "invalid_status_undefined");
});

test("normalizeItems: Retorna null para items vacío", () => {
  const result = normalizeItems([]);
  assert.equal(result, null);
});

test("normalizeItems: Normaliza correctamente", () => {
  const result = normalizeItems([
    { nombre: "Camarones", precio: 180, cantidad: 2 },
  ]);

  assert.ok(Array.isArray(result));
  assert.equal(result[0].name, "Camarones");
  assert.equal(result[0].quantity, 2);
  assert.equal(result[0].lineTotal, 360);
});

// ============================================================================
// 20. CONCURRENCIA: DOBLE-CHECK ANTES DE CREAR
// ============================================================================

test("CONCURRENCIA: Doble-check previene duplicados si dos procesos corren simultáneamente", async () => {
  let findOneCallCount = 0;
  const entry = historialEntry();
  const stableId = generateStableId("customer-a", entry);

  const fixture = backfillFixture({
    customers: [cliente({ historialPedidos: [entry] })],
  });

  // Inyectar lógica para simular race condition
  const originalFindOne = fixture.Order.findOne;
  fixture.Order.findOne = async (query) => {
    if (query["legacySource.type"]) {
      findOneCallCount += 1;
      // Primera llamada: no existe
      // Segunda llamada: ahora existe (simulando que otro proceso lo creó)
      if (findOneCallCount === 2) {
        return { _id: "already-created" };
      }
    }
    return originalFindOne.call(fixture.Order, query);
  };

  const result = await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  // El doble-check debe detectar que ya existe
  assert.equal(result.alreadyMigrated, 1);
  assert.equal(result.migrated, 0);
});

// ============================================================================
// 21. MÚLTIPLES ENTRADAS POR CLIENTE
// ============================================================================

test("MÚLTIPLE: Cliente con varios historialPedidos se procesa", async () => {
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({ _id: "entry-1" }),
          historialEntry({ _id: "entry-2", estadoFinal: "cancelado" }),
          historialEntry({ _id: "entry-3" }),
        ],
      }),
    ],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.scannedCustomers, 1);
  assert.equal(result.scannedEntries, 3);
  assert.equal(result.ready, 3);
});

// ============================================================================
// 22. CLIENTE CON HISTORIAL VACÍO SE IGNORA
// ============================================================================

test("IGNORADO: Cliente sin historialPedidos", async () => {
  const fixture = backfillFixture({
    customers: [cliente({ historialPedidos: [] })],
  });

  const result = await backfillLegacyOrders({ ...fixture });

  assert.equal(result.scannedCustomers, 1);
  assert.equal(result.scannedEntries, 0);
});

// ============================================================================
// 23. MOTIVO CANCELACIÓN PRESERVADO
// ============================================================================

test("MOTIVO: motivoCancelacion preservado en statusHistory", async () => {
  const motivo = "Cliente solicitó cancelación";
  const fixture = backfillFixture({
    customers: [
      cliente({
        historialPedidos: [
          historialEntry({
            estadoFinal: "cancelado",
            motivoCancelacion: motivo,
          }),
        ],
      }),
    ],
  });

  await backfillLegacyOrders({
    ...fixture,
    apply: true,
    confirmation: REQUIRED_CONFIRMATION,
  });

  const order = fixture.created[0];
  assert.equal(order.statusHistory[0].note, motivo);
});
