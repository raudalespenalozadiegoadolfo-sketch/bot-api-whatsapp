/**
 * FASE 1.6.1 — Legacy Order Backfill Service
 *
 * Herramienta para migrar pedidos históricos embebidos en
 * Cliente.historialPedidos hacia la colección Order de manera
 * controlada, segura e idempotente.
 *
 * Principios:
 * - DRY-RUN por defecto (nunca escribe)
 * - APPLY protegido (requiere confirmación explícita)
 * - Tenant-safe (nunca infiere tenant desde datos untrusted)
 * - Idempotente (detección de registros ya migrados)
 * - Sin PII en logs
 * - Independencia de registros
 */

const crypto = require("crypto");


// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const REQUIRED_CONFIRMATION = "MIGRATE_LEGACY_ORDERS";
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;


/**
 * Mapeo de estados legacy a estados canónicos de Order.
 */
const LEGACY_STATUS_MAP = Object.freeze({
  confirmado: "confirmed",
  cocina: "processing",
  en_camino: "in_fulfillment",
  entregado: "completed",
  cancelado: "cancelled",
});


/**
 * Solamente estos estados son válidos para migrar historialPedidos.
 *
 * No inferimos que un registro fue entregado únicamente por estar
 * almacenado dentro de Cliente.historialPedidos.
 */
const TERMINAL_LEGACY_STATUSES = Object.freeze([
  "entregado",
  "cancelado",
]);


/**
 * Resultados posibles para cada registro.
 */
const RECORD_STATUS = Object.freeze({
  READY: "READY",
  BLOCKED: "BLOCKED",
  ALREADY_MIGRATED: "ALREADY_MIGRATED",
  MIGRATED: "MIGRATED",
  ERROR: "ERROR",
});


// ============================================================================
// VALIDACIONES Y CONVERSIONES
// ============================================================================

function normalizeBatchSize(value = DEFAULT_BATCH_SIZE) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batch-size debe ser un entero entre 1 y ${MAX_BATCH_SIZE}.`
    );
  }

  return parsed;
}


/**
 * Genera un stableId determinista para un pedido legacy.
 *
 * Se conserva esta implementación para mantener compatibilidad e
 * idempotencia con los análisis y dry-runs realizados previamente.
 */
function generateStableId(customerId, historialEntry) {
  const payload = {
    customerId: String(customerId || ""),

    fecha: historialEntry?.fecha
      ? new Date(historialEntry.fecha).toISOString()
      : null,

    estadoFinal: historialEntry?.estadoFinal || null,

    pedidos: (historialEntry?.pedidos || []).map((item) => ({
      nombre: String(item?.nombre || "").trim(),
      precio: Number(item?.precio),
      cantidad: Number(item?.cantidad) || 1,
    })),

    total: Number(historialEntry?.total),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}


/**
 * Normaliza y valida items del pedido legacy.
 *
 * Esquemas soportados:
 * - { nombre, precio, cantidad }
 * - { nombre, precio } -> cantidad default 1
 */
function normalizeItems(legacyItems) {
  if (!Array.isArray(legacyItems) || !legacyItems.length) {
    return null;
  }

  const normalized = legacyItems.map((item) => {
    const name = String(item?.nombre || "").trim();

    let quantity = Number(item?.cantidad);

    /*
     * Compatibilidad con pedidos legacy antiguos que no guardaban
     * explícitamente cantidad.
     */
    if (!Number.isFinite(quantity) || quantity < 1) {
      quantity = item?.cantidad === undefined ? 1 : null;
    }

    const unitPrice = Number(item?.precio);

    if (
      !name ||
      !Number.isFinite(quantity) ||
      quantity < 1 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      return null;
    }

    return {
      productId: /^[a-f\d]{24}$/i.test(
        String(item?.productId || "")
      )
        ? item.productId
        : null,

      name: name.slice(0, 160),
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
      sku: "",
      variant: null,
      options: [],
    };
  });

  if (normalized.some((item) => !item)) {
    return null;
  }

  return normalized;
}


/**
 * Diagnóstico READ-ONLY de una entrada legacy.
 *
 * No imprime teléfono, dirección, nombre completo ni contenido
 * completo del pedido.
 */
function diagnosticLegacyEntry(
  customer,
  historialEntry,
  stableId
) {
  const fieldNames = Object.keys(historialEntry || {});
  const statusCandidates = {};

  const statusFieldNames = [
    "status",
    "estado",
    "estadoFinal",
    "estadoPedido",
    "tipoEstado",
    "state",
    "orderStatus",
    "cancelado",
    "entregado",
    "completado",
    "fulfilled",
    "fechaEntrega",
    "fechaCancelacion",
    "estadoDelivery",
  ];

  for (const fieldName of statusFieldNames) {
    if (fieldName in (historialEntry || {})) {
      const value = historialEntry[fieldName];

      statusCandidates[fieldName] = {
        type: typeof value,
        isNull: value === null,
        isUndefined: value === undefined,
        isFalsy: !value,

        value:
          typeof value === "string"
            ? value
            : typeof value === "number" ||
                typeof value === "boolean"
              ? String(value)
              : typeof value,
      };
    }
  }

  return {
    customerId: String(customer._id),
    tenantId: String(customer.tenantId),
    stableId,

    fieldsPresent: fieldNames,
    fieldCount: fieldNames.length,

    statusCandidates,

    itemCount: Array.isArray(historialEntry?.pedidos)
      ? historialEntry.pedidos.length
      : 0,

    hasTotal: "total" in (historialEntry || {}),
    hasFecha: "fecha" in (historialEntry || {}),
  };
}


/**
 * Convierte una entrada de Cliente.historialPedidos a Order.
 *
 * Requisitos:
 * - Cliente válido
 * - tenantId válido
 * - estadoFinal terminal explícito
 * - fecha válida
 * - items reconstruibles
 *
 * IMPORTANTE:
 * No se infiere "entregado" cuando estadoFinal no existe.
 * Los registros ambiguos permanecen BLOCKED.
 */
function convertLegacyEntry(customer, historialEntry) {
  // --------------------------------------------------------------------------
  // 1. Cliente
  // --------------------------------------------------------------------------

  if (!customer?._id) {
    return {
      status: RECORD_STATUS.BLOCKED,
      reason: "missing_customer_id",
    };
  }


  // --------------------------------------------------------------------------
  // 2. Tenant
  // --------------------------------------------------------------------------

  if (!customer.tenantId) {
    return {
      status: RECORD_STATUS.BLOCKED,
      reason: "missing_tenant_id",
    };
  }


  // --------------------------------------------------------------------------
  // 3. Estado terminal explícito
  // --------------------------------------------------------------------------

  const legacyStatusFinal = historialEntry?.estadoFinal;

  const isValidStatus =
    TERMINAL_LEGACY_STATUSES.includes(legacyStatusFinal);

  let canonicalStatus = null;

  if (isValidStatus) {
    canonicalStatus =
      LEGACY_STATUS_MAP[legacyStatusFinal];
  }

  /*
   * No hacer fallback a "entregado".
   *
   * Estar dentro de historialPedidos no constituye evidencia
   * suficiente para afirmar que el pedido fue entregado.
   */
  if (!canonicalStatus) {
    const stableId = generateStableId(
      customer._id,
      historialEntry
    );

    return {
      status: RECORD_STATUS.BLOCKED,
      reason: `invalid_status_${legacyStatusFinal}`,

      diagnostic: diagnosticLegacyEntry(
        customer,
        historialEntry,
        stableId
      ),
    };
  }


  // --------------------------------------------------------------------------
  // 4. Fecha
  // --------------------------------------------------------------------------

  const entryDate = new Date(historialEntry?.fecha);

  if (Number.isNaN(entryDate.getTime())) {
    return {
      status: RECORD_STATUS.BLOCKED,
      reason: "invalid_date",
    };
  }


  // --------------------------------------------------------------------------
  // 5. Items
  // --------------------------------------------------------------------------

  const items = normalizeItems(
    historialEntry?.pedidos
  );

  if (!items) {
    return {
      status: RECORD_STATUS.BLOCKED,
      reason: "invalid_items",
    };
  }


  // --------------------------------------------------------------------------
  // 6. Totales
  // --------------------------------------------------------------------------

  const subtotal = items.reduce(
    (sum, item) => sum + item.lineTotal,
    0
  );

  const legacyTotal = Number(
    historialEntry?.total
  );

  const total =
    Number.isFinite(legacyTotal) &&
    legacyTotal >= 0
      ? legacyTotal
      : subtotal;


  // --------------------------------------------------------------------------
  // 7. Stable ID
  // --------------------------------------------------------------------------

  const stableId = generateStableId(
    customer._id,
    historialEntry
  );


  // --------------------------------------------------------------------------
  // 8. Construcción canónica
  // --------------------------------------------------------------------------

  const orderData = {
    tenantId: customer.tenantId,

    branchId:
      customer.branchId || null,

    customerId:
      customer._id,

    channel:
      "other",

    status:
      canonicalStatus,

    /*
     * Conservamos únicamente el estado realmente presente
     * en el registro histórico.
     */
    legacyStatus:
      legacyStatusFinal || null,

    items,
    subtotal,
    total,

    currency:
      "MXN",

    fulfillment: {
      type:
        historialEntry?.direccion
          ? "delivery"
          : "none",

      address:
        historialEntry?.direccion || null,
    },

    customerSnapshot: {
      name: String(
        historialEntry?.nombre || ""
      ).slice(0, 160),

      phone: String(
        historialEntry?.numero || ""
      ).slice(0, 50),
    },

    notes: "",

    metadata: {
      backfill: "cliente_historial_v1",
    },

    statusHistory: [
      {
        status:
          canonicalStatus,

        at:
          entryDate,

        note: String(
          historialEntry?.motivoCancelacion || ""
        ).slice(0, 300),
      },
    ],

    legacySource: {
      type:
        "cliente_historial",

      customerId:
        customer._id,

      legacyEntryId:
        stableId,
    },

    createdAt:
      entryDate,

    updatedAt:
      entryDate,
  };

  return {
    status:
      RECORD_STATUS.READY,

    stableId,
    orderData,
  };
}


/**
 * Query tenant-aware para detectar un Order ya migrado.
 */
function buildLegacyLookupQuery(
  tenantId,
  customerId,
  stableId
) {
  return {
    tenantId,

    "legacySource.type":
      "cliente_historial",

    "legacySource.customerId":
      customerId,

    "legacySource.legacyEntryId":
      stableId,
  };
}


/**
 * Genera un orderNumber determinista para el pedido legacy.
 */
async function chooseOrderNumber(
  Order,
  tenantId,
  stableId
) {
  const preferred =
    `LEGACY-${stableId
      .slice(0, 24)
      .toUpperCase()}`;

  if (
    !await Order.findOne({
      tenantId,
      orderNumber: preferred,
    })
  ) {
    return preferred;
  }

  const hash = crypto
    .createHash("sha256")
    .update(stableId)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();

  const alternative =
    `LEGACY-${hash}`;

  if (
    !await Order.findOne({
      tenantId,
      orderNumber: alternative,
    })
  ) {
    return alternative;
  }

  return null;
}


/**
 * Incrementa contadores globales y por tenant.
 */
function incrementCounter(
  summary,
  tenantId,
  field
) {
  summary[field] += 1;

  const tenantKey = tenantId
    ? String(tenantId)
    : "BLOCKED_NO_TENANT";

  summary.byTenant[tenantKey] ??= {
    scannedEntries: 0,
    ready: 0,
    blocked: 0,
    alreadyMigrated: 0,
    migrated: 0,
    errors: 0,
  };

  summary.byTenant[tenantKey][field] += 1;
}


// ============================================================================
// LOGGING
// ============================================================================

function safeLog(event, data = {}) {
  return {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
}


// ============================================================================
// BACKFILL
// ============================================================================

async function backfillLegacyOrders({
  Cliente,
  Order,
  apply = false,
  confirmation = "",
  batchSize = DEFAULT_BATCH_SIZE,
  logger = (value) =>
    console.log(JSON.stringify(value)),
}) {
  /*
   * APPLY requiere confirmación explícita.
   */
  if (
    apply &&
    confirmation !== REQUIRED_CONFIRMATION
  ) {
    throw new Error(
      `Confirmación requerida para apply: --confirm=${REQUIRED_CONFIRMATION}`
    );
  }

  const safeBatchSize =
    normalizeBatchSize(batchSize);


  const summary = {
    mode:
      apply
        ? "APPLY"
        : "DRY_RUN",

    scannedCustomers: 0,
    scannedEntries: 0,

    ready: 0,
    blocked: 0,
    alreadyMigrated: 0,
    migrated: 0,
    errors: 0,

    byTenant: {},
  };


  /*
   * Cursor para evitar cargar toda la colección en memoria.
   */
  const cursor = Cliente.find({
    historialPedidos: {
      $exists: true,
      $ne: [],
    },
  })
    .select(
      "_id tenantId branchId historialPedidos"
    )
    .lean()
    .cursor({
      batchSize: safeBatchSize,
    });


  for await (const customer of cursor) {
    summary.scannedCustomers += 1;

    if (
      !Array.isArray(
        customer.historialPedidos
      )
    ) {
      continue;
    }


    for (
      const historialEntry
      of customer.historialPedidos
    ) {
      incrementCounter(
        summary,
        customer.tenantId,
        "scannedEntries"
      );

      try {
        const conversion =
          convertLegacyEntry(
            customer,
            historialEntry
          );


        // --------------------------------------------------------------------
        // Registro no migrable
        // --------------------------------------------------------------------

        if (
          conversion.status !==
          RECORD_STATUS.READY
        ) {
          incrementCounter(
            summary,
            customer.tenantId,
            "blocked"
          );

          logger(
            safeLog(
              "legacy_order_backfill",
              {
                tenantId:
                  customer.tenantId
                    ? String(
                        customer.tenantId
                      )
                    : null,

                customerId:
                  String(customer._id),

                result:
                  conversion.status,

                reason:
                  conversion.reason,
              }
            )
          );

          continue;
        }


        const {
          stableId,
          orderData,
        } = conversion;


        const lookupQuery =
          buildLegacyLookupQuery(
            customer.tenantId,
            customer._id,
            stableId
          );


        // --------------------------------------------------------------------
        // Ya migrado
        // --------------------------------------------------------------------

        if (
          await Order.findOne(
            lookupQuery
          )
        ) {
          incrementCounter(
            summary,
            customer.tenantId,
            "alreadyMigrated"
          );

          logger(
            safeLog(
              "legacy_order_backfill",
              {
                tenantId:
                  String(
                    customer.tenantId
                  ),

                customerId:
                  String(
                    customer._id
                  ),

                result:
                  RECORD_STATUS
                    .ALREADY_MIGRATED,
              }
            )
          );

          continue;
        }


        // --------------------------------------------------------------------
        // DRY-RUN
        // --------------------------------------------------------------------

        if (!apply) {
          incrementCounter(
            summary,
            customer.tenantId,
            "ready"
          );

          logger(
            safeLog(
              "legacy_order_backfill",
              {
                tenantId:
                  String(
                    customer.tenantId
                  ),

                customerId:
                  String(
                    customer._id
                  ),

                result:
                  RECORD_STATUS.READY,
              }
            )
          );

          continue;
        }


        // --------------------------------------------------------------------
        // APPLY
        // --------------------------------------------------------------------

        const orderNumber =
          await chooseOrderNumber(
            Order,
            customer.tenantId,
            stableId
          );


        if (!orderNumber) {
          incrementCounter(
            summary,
            customer.tenantId,
            "blocked"
          );

          logger(
            safeLog(
              "legacy_order_backfill",
              {
                tenantId:
                  String(
                    customer.tenantId
                  ),

                customerId:
                  String(
                    customer._id
                  ),

                result:
                  RECORD_STATUS.BLOCKED,

                reason:
                  "order_number_collision",
              }
            )
          );

          continue;
        }


        /*
         * Segunda comprobación antes del create.
         *
         * El índice único de legacySource en Order constituye
         * la barrera final frente a concurrencia.
         */
        if (
          await Order.findOne(
            lookupQuery
          )
        ) {
          incrementCounter(
            summary,
            customer.tenantId,
            "alreadyMigrated"
          );

          continue;
        }


        try {
          await Order.create({
            ...orderData,
            orderNumber,
          });


          incrementCounter(
            summary,
            customer.tenantId,
            "migrated"
          );


          logger(
            safeLog(
              "legacy_order_backfill",
              {
                tenantId:
                  String(
                    customer.tenantId
                  ),

                customerId:
                  String(
                    customer._id
                  ),

                result:
                  RECORD_STATUS.MIGRATED,
              }
            )
          );
        } catch (createError) {
          /*
           * MongoDB duplicate key.
           *
           * Puede ocurrir si otro proceso creó el mismo Order
           * entre el último findOne y el create.
           */
          if (
            createError?.code === 11000
          ) {
            if (
              await Order.findOne(
                lookupQuery
              )
            ) {
              incrementCounter(
                summary,
                customer.tenantId,
                "alreadyMigrated"
              );
            } else {
              incrementCounter(
                summary,
                customer.tenantId,
                "blocked"
              );

              logger(
                safeLog(
                  "legacy_order_backfill",
                  {
                    tenantId:
                      String(
                        customer.tenantId
                      ),

                    customerId:
                      String(
                        customer._id
                      ),

                    result:
                      RECORD_STATUS
                        .BLOCKED,

                    reason:
                      "duplicate_key_error",
                  }
                )
              );
            }
          } else {
            incrementCounter(
              summary,
              customer.tenantId,
              "errors"
            );

            logger(
              safeLog(
                "legacy_order_backfill",
                {
                  tenantId:
                    String(
                      customer.tenantId
                    ),

                  customerId:
                    String(
                      customer._id
                    ),

                  result:
                    RECORD_STATUS.ERROR,

                  reason:
                    createError?.message,
                }
              )
            );
          }
        }
      } catch (error) {
        incrementCounter(
          summary,
          customer.tenantId,
          "errors"
        );

        logger(
          safeLog(
            "legacy_order_backfill",
            {
              tenantId:
                customer.tenantId
                  ? String(
                      customer.tenantId
                    )
                  : null,

              customerId:
                String(
                  customer._id
                ),

              result:
                RECORD_STATUS.ERROR,

              reason:
                error?.message,
            }
          )
        );
      }
    }
  }


  return summary;
}


// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  REQUIRED_CONFIRMATION,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,

  LEGACY_STATUS_MAP,
  TERMINAL_LEGACY_STATUSES,
  RECORD_STATUS,

  backfillLegacyOrders,

  normalizeBatchSize,
  convertLegacyEntry,
  generateStableId,
  normalizeItems,
  diagnosticLegacyEntry,

  buildLegacyLookupQuery,
  chooseOrderNumber,
  incrementCounter,
  safeLog,
};