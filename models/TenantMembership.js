const mongoose = require("mongoose");

const tenantMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["owner", "administrator", "manager", "staff"],
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

tenantMembershipSchema.index(
  { userId: 1, tenantId: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.TenantMembership ||
  mongoose.model("TenantMembership", tenantMembershipSchema);
