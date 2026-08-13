const mongoose = require("mongoose");

const optionalPositiveInteger = {
  validator(value) {
    return (
      value === null ||
      value === undefined ||
      (Number.isInteger(value) && value >= 1)
    );
  },
  message: "El límite debe ser un entero mayor a 0.",
};

const cuponSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 40,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 250,
    },

    type: {
      type: String,
      enum: ["percent", "fixed"],
      default: "percent",
      required: true,
    },

    value: {
      type: Number,
      required: true,
      min: 0.01,
      validate: {
        validator(value) {
          return this.type !== "percent" || value <= 100;
        },
        message: "El porcentaje no puede ser mayor a 100.",
      },
    },

    minimumPurchase: {
      type: Number,
      default: 0,
      min: 0,
    },

    maxDiscount: {
      type: Number,
      default: null,
      min: 0,
    },

    startsAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          return !value || !this.startsAt || value >= this.startsAt;
        },
        message: "La fecha de vencimiento no puede ser anterior a la fecha de inicio.",
      },
    },

    active: {
      type: Boolean,
      default: true,
    },

    usageLimit: {
      type: Number,
      default: null,
      validate: optionalPositiveInteger,
    },

    perCustomerLimit: {
      type: Number,
      default: null,
      validate: optionalPositiveInteger,
    },

    timesUsed: {
      type: Number,
      default: 0,
      min: 0,
    },

    customerUsage: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
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

cuponSchema.index({ tenantId: 1, code: 1 }, { unique: true });
cuponSchema.index({ tenantId: 1, active: 1, order: 1 });

const Cupon =
  mongoose.models.Cupon ||
  mongoose.model("Cupon", cuponSchema);

module.exports = Cupon;
