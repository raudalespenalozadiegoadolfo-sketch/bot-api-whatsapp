const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      unique: true,
    },
    storefrontKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      unique: true,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "onboarding", "cancelled"],
      default: "active",
      index: true,
    },
    timezone: {
      type: String,
      default: "America/Mexico_City",
      trim: true,
      maxlength: 80,
    },
    currency: {
      type: String,
      default: "MXN",
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Tenant ||
  mongoose.model("Tenant", tenantSchema);
