const mongoose = require("mongoose");

const whatsappChannelSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    provider: {
      type: String,
      enum: ["meta"],
      default: "meta",
      required: true,
    },
    phoneNumberId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    whatsappBusinessAccountId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    displayPhoneNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

whatsappChannelSchema.index(
  { provider: 1, phoneNumberId: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.WhatsAppChannel ||
  mongoose.model("WhatsAppChannel", whatsappChannelSchema);
