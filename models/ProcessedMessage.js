const mongoose = require("mongoose");

const errorSchema = new mongoose.Schema(
  {
    name: String,
    code: String,
    message: String,
  },
  { _id: false }
);

const processedMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["received", "processing", "completed", "failed"],
      default: "received",
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    processingToken: {
      type: String,
      default: null,
    },
    processingStartedAt: Date,
    processingLeaseUntil: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: errorSchema,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: "7d",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProcessedMessage", processedMessageSchema);
