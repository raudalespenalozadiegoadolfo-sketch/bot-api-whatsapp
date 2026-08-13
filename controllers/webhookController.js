const crypto = require("crypto");
const env = require("../config/env");
const {
  acquireMessage,
  completeMessage,
  failMessage,
  getMessagesFromWebhook,
  sanitizeError,
} = require("../services/messageService");
const { logWebhookEvent } = require("../services/webhookLogger");
const { handleIncoming } = require("./botFlowController");
const { resolveTenantFromPhoneNumberId } = require("../services/tenantResolverService");
const { createTenantCatalog } = require("../services/tenantCatalogService");

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === env.VERIFY_TOKEN
  ) {
    console.log("✅ Webhook verificado por Meta");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Intento de verificación rechazado");
  return res.sendStatus(403);
}

function validateSignature(req) {
  const receivedSignature =
    req.get("x-hub-signature-256") || "";

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", env.APP_SECRET)
    .update(req.rawBody || Buffer.from(""))
    .digest("hex")}`;

  if (
    receivedSignature.length !==
    expectedSignature.length
  ) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSignature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error(
      "❌ Error comparando la firma:",
      error.message
    );

    return false;
  }
}

async function processMessagesReliably(messages) {
  for (const message of messages) {
    const messageId = message.id;
    let acquisition = null;

    logWebhookEvent("info", "webhook_received", {
      messageId,
    });

    try {
      const tenantContext = await resolveTenantFromPhoneNumberId(
        message.webhookMetadata?.phoneNumberId
      );
      if (!tenantContext.resolved) {
        logWebhookEvent("warn", "tenant_resolution_rejected", {
          messageId,
          reason: tenantContext.reason,
        });
        continue;
      }

      acquisition = await acquireMessage(messageId);

      if (!acquisition.acquired) {
        logWebhookEvent(
          "info",
          acquisition.reason === "completed"
            ? "duplicate_completed"
            : "processing_active",
          {
            messageId,
            attempts: acquisition.attempts,
          }
        );
        continue;
      }

      logWebhookEvent(
        "info",
        acquisition.reclaimed
          ? "stale_or_failed_reclaimed"
          : "processing_acquired",
        {
          messageId,
          attempts: acquisition.attempts,
        }
      );

      await handleIncoming(message, {
        ...tenantContext,
        catalog: createTenantCatalog(tenantContext.tenantId),
      });

      await completeMessage(
        messageId,
        acquisition.processingToken
      );

      logWebhookEvent("info", "processing_completed", {
        messageId,
        attempts: acquisition.attempts,
      });
    } catch (error) {
      const safeError = sanitizeError(error);

      if (acquisition?.acquired) {
        try {
          await failMessage(
            messageId,
            acquisition.processingToken,
            error
          );
        } catch (stateError) {
          logWebhookEvent("error", "processing_state_update_failed", {
            messageId,
            error: sanitizeError(stateError),
          });
        }
      }

      logWebhookEvent("error", "processing_failed", {
        messageId,
        error: safeError,
      });
    }
  }
}

function receiveWebhook(req, res) {
  if (!validateSignature(req)) {
    console.warn("❌ Firma del webhook inválida");
    return res.sendStatus(401);
  }

  const messages = getMessagesFromWebhook(req.body);

  console.log(
    `📨 Mensajes recibidos por nuevo controlador: ${messages.length}`
  );

  // Meta necesita recibir rápidamente el código 200.
  res.sendStatus(200);

  // Procesamos después de responder a Meta.
  void processMessagesReliably(messages);
}

module.exports = {
  processMessages: processMessagesReliably,
  verifyWebhook,
  receiveWebhook,
};
