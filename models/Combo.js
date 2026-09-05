const mongoose = require("mongoose");

/* =========================
   ITEM DEL COMBO
========================= */

const comboItemSchema = new mongoose.Schema(
  {
    /*
     * product  = producto específico
     * category = cualquier producto
     *            de una categoría
     */
    mode: {
      type: String,
      enum: [
        "product",
        "category",
      ],
      default: "product",
      required: true,
    },

    /*
     * Usado cuando mode = product
     */
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Producto",
      default: null,
    },

    /*
     * Usado cuando mode = category
     */
    category: {
      type: String,
      default: "",
      trim: true,
    },

    excludedProductIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Producto",
        },
      ],
      default: [],
    },

    /*
     * Texto que verá el cliente.
     *
     * Ejemplo:
     * "Elige tu aguachile"
     */
    label: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },

    cantidad: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
      default: 1,
    },
  },
  {
    _id: false,
  }
);

/* =========================
   COMBO
========================= */

const comboSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    items: {
      type: [comboItemSchema],
      default: [],
      required: true,
    },

    normalPrice: {
      type: Number,
      min: 0,
      default: 0,
    },

    comboPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    imageUrl: {
      type: String,
      default: "",
      trim: true,
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

comboSchema.index({ tenantId: 1, active: 1, order: 1 });

const Combo =
  mongoose.models.Combo ||
  mongoose.model(
    "Combo",
    comboSchema
  );

module.exports = Combo;
