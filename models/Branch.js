const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
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
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    timezone: {
      type: String,
      default: null,
      trim: true,
      maxlength: 80,
    },
  },
  { timestamps: true }
);

branchSchema.index(
  { tenantId: 1, slug: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.Branch ||
  mongoose.model("Branch", branchSchema);
