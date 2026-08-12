const mongoose = require("mongoose");

/* =========================
   ESQUEMA DE PRODUCTO
========================= */

const productoSchema = new mongoose.Schema(
  {
    legacyId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
      index: true,
    },

    source: {
      type: String,
      enum: [
        "legacy",
        "admin",
      ],
      default: "admin",
      index: true,
    },

    name: {
      type: String,
      required: [
        true,
        "El nombre del producto es obligatorio.",
      ],
      trim: true,
      maxlength: 120,
      index: true,
    },

    category: {
      type: String,
      required: [
        true,
        "La categoría es obligatoria.",
      ],
      trim: true,
      maxlength: 80,
      index: true,
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
      index: true,
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
      index: true,
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
