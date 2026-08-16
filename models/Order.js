const mongoose = require("mongoose");


const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Producto",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    sku: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100,
    },
    variant: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    options: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { _id: false }
);


const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: "",
      maxlength: 300,
    },
  },
  { _id: false }
);


const orderSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cliente",
      required: true,
    },

    orderNumber: {
      type: String,
      required: true,
    },

    channel: {
      type: String,
      enum: ["whatsapp", "storefront", "admin", "other"],
      default: "other",
    },

    status: {
      type: String,
      enum: [
        "draft",
        "confirmed",
        "processing",
        "ready",
        "in_fulfillment",
        "completed",
        "cancelled",
      ],
      default: "confirmed",
    },

    legacyStatus: {
      type: String,
      default: "confirmado",
    },

    items: {
      type: [orderItemSchema],
      required: true,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    fees: {
      type: Number,
      default: 0,
      min: 0,
    },

    total: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "MXN",
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },

    fulfillment: {
      type: {
        type: String,
        enum: [
          "delivery",
          "pickup",
          "shipping",
          "service",
          "digital",
          "none",
        ],
        default: "none",
      },
      address: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },

    customerSnapshot: {
      name: {
        type: String,
        default: "",
      },
      phone: {
        type: String,
        default: "",
      },
    },

    notes: {
      type: String,
      default: "",
      maxlength: 1000,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
     * Identidad del pedido histórico original.
     *
     * Solo se utiliza para Orders creados mediante el backfill de
     * Cliente.historialPedidos.
     */
    legacySource: {
      type: {
        type: String,
        enum: ["cliente_historial"],
        default: undefined,
      },
      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Cliente",
        default: undefined,
      },
      legacyEntryId: {
        type: String,
        default: undefined,
        maxlength: 128,
      },
    },

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);


/*
 * Identidad normal del pedido dentro de cada tenant.
 */
orderSchema.index(
  { tenantId: 1, orderNumber: 1 },
  { unique: true }
);


/*
 * Consultas operativas del panel.
 */
orderSchema.index({
  tenantId: 1,
  status: 1,
  createdAt: -1,
});


/*
 * Historial de pedidos de un cliente dentro de un tenant.
 */
orderSchema.index({
  tenantId: 1,
  customerId: 1,
  createdAt: -1,
});


/*
 * Protección de idempotencia del backfill legacy.
 *
 * Un mismo registro de Cliente.historialPedidos solamente puede producir
 * un Order por tenant/cliente, incluso si dos procesos intentaran migrarlo
 * simultáneamente.
 *
 * Es parcial para no afectar Orders normales creados por WhatsApp,
 * storefront o administración.
 */
orderSchema.index(
  {
    tenantId: 1,
    "legacySource.type": 1,
    "legacySource.customerId": 1,
    "legacySource.legacyEntryId": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      "legacySource.type": "cliente_historial",
      "legacySource.legacyEntryId": { $type: "string" },
    },
  }
);


module.exports =
  mongoose.models.Order || mongoose.model("Order", orderSchema);