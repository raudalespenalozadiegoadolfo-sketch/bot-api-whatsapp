const mongoose = require("mongoose");

const categoriaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    normalizedName: {
      type: String,
      required: true,
      unique: true,
      index: true,
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

const Categoria =
  mongoose.models.Categoria ||
  mongoose.model(
    "Categoria",
    categoriaSchema
  );

module.exports = Categoria;