const mongoose = require("mongoose");

/* =========================
   ESQUEMA DE PRODUCTO
========================= */

const productoSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    legacyId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },

    source: {
      type: String,
      enum: [
        "legacy",
        "admin",
      ],
      default: "admin",
    },

    name: {
      type: String,
      required: [
        true,
        "El nombre del producto es obligatorio.",
      ],
      trim: true,
      maxlength: 120,
    },

    category: {
      type: String,
      required: [
        true,
        "La categoría es obligatoria.",
      ],
      trim: true,
      maxlength: 80,
    },

    price: {
      type: Number,
      required: [
        true,
        "El precio es obligatorio.",
      ],
      min: [
        0,
        "El precio no puede ser negativo.",
      ],
    },

    type: {
      type: String,
      enum: [
        "food",
        "drink",
      ],
      default: "food",
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },

    aliases: {
      type: [String],
      default: [],
    },

    active: {
      type: Boolean,
      default: true,
    },

    order: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

productoSchema.index({ tenantId: 1, active: 1, category: 1, order: 1 });
productoSchema.index(
  { tenantId: 1, source: 1, legacyId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source: "legacy",
      legacyId: { $type: "string", $gt: "" },
    },
  }
);

/* =========================
   EVITAR MODELO DUPLICADO
========================= */

const Producto =
  mongoose.models.Producto ||
  mongoose.model(
    "Producto",
    productoSchema
  );

module.exports = Producto;
