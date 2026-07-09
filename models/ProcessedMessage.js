const mongoose = require("mongoose");

const processedMessageSchema = new mongoose.Schema({
  messageId: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now, expires: "7d" },
});

module.exports = mongoose.model("ProcessedMessage", processedMessageSchema);