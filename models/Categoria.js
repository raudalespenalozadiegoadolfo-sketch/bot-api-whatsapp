const mongoose = require("mongoose");

const categoriaSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    normalizedName: {
      type: String,
      required: true,
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

categoriaSchema.index(
  { tenantId: 1, normalizedName: 1 },
  { unique: true }
);
categoriaSchema.index({ tenantId: 1, active: 1, order: 1 });

const Categoria =
  mongoose.models.Categoria ||
  mongoose.model(
    "Categoria",
    categoriaSchema
  );

module.exports = Categoria;
