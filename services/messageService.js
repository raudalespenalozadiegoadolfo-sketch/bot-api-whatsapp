const ProcessedMessage = require("../models/ProcessedMessage");
const crypto = require("crypto");

const PROCESSING_LEASE_MS = Number(
  process.env.MESSAGE_PROCESSING_LEASE_MS ||
    2 * 60 * 1000
);

function sanitizeError(error) {
  return {
    name: String(error?.name || "Error").slice(0, 80),
    code: String(error?.code || "").slice(0, 80),
    message: String(error?.message || "Error de procesamiento")
      .replace(/(bearer\s+|token[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
      .slice(0, 300),
  };
}

async function acquireMessage(messageId, options = {}) {
  const now = options.now || new Date();
  const leaseMs = options.leaseMs || PROCESSING_LEASE_MS;
  const processingToken = crypto.randomBytes(24).toString("hex");

  try {
    const record = await ProcessedMessage.findOneAndUpdate(
      {
        messageId,
        $or: [
          { status: "received" },
          { status: "failed" },
          { status: { $exists: false } },
          {
            status: "processing",
            processingLeaseUntil: { $lte: now },
          },
        ],
      },
      {
        $setOnInsert: { messageId },
        $set: {
          status: "processing",
          processingToken,
          processingStartedAt: now,
          processingLeaseUntil: new Date(now.getTime() + leaseMs),
          completedAt: null,
          lastError: null,
        },
        $inc: { attempts: 1 },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return {
      acquired: true,
      processingToken,
      attempts: Number(record.attempts || 1),
      reclaimed: Number(record.attempts || 1) > 1,
    };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await ProcessedMessage.findOne({ messageId }).lean();
    return {
      acquired: false,
      reason: existing?.status === "completed"
        ? "completed"
        : "processing",
      attempts: Number(existing?.attempts || 0),
    };
  }
}

async function completeMessage(messageId, processingToken, now = new Date()) {
  return ProcessedMessage.findOneAndUpdate(
    { messageId, status: "processing", processingToken },
    {
      $set: {
        status: "completed",
        completedAt: now,
        processingLeaseUntil: null,
        lastError: null,
      },
      $unset: { processingToken: 1 },
    },
    { new: true }
  );
}

async function failMessage(messageId, processingToken, error) {
  return ProcessedMessage.findOneAndUpdate(
    { messageId, status: "processing", processingToken },
    {
      $set: {
        status: "failed",
        lastError: sanitizeError(error),
        processingLeaseUntil: null,
      },
      $unset: { processingToken: 1 },
    },
    { new: true }
  );
}

async function alreadyProcessed(messageId) {
  try {
    await ProcessedMessage.create({ messageId });
    return false;
  } catch (error) {
    if (error.code === 11000) return true;
    throw error;
  }
}

function getMessagesFromWebhook(body) {
  return body.entry?.flatMap(entry => entry.changes || [])
    .flatMap(change => {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      return (change.value?.messages || []).map(message => ({
        ...message,
        webhookMetadata: { phoneNumberId },
      }));
    }) || [];
}

module.exports = {
  acquireMessage,
  alreadyProcessed,
  completeMessage,
  failMessage,
  getMessagesFromWebhook,
  sanitizeError,
};
