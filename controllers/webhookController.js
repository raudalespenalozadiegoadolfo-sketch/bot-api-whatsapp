const crypto = require("crypto");
const env = require("../config/env");
const { getMessagesFromWebhook } = require("../services/messageService");
const { handleIncoming } = require("./botFlowController");

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

async function processMessages(messages) {
  for (const message of messages) {
    try {
      console.log("📩 Procesando mensaje:", {
        id: message.id,
        from: message.from,
        type: message.type,
        text: message.text?.body || "",
        button:
          message.interactive?.button_reply?.id || "",
        list:
          message.interactive?.list_reply?.id || "",
      });

      await handleIncoming(message);

      console.log(
        "✅ Mensaje procesado correctamente:",
        message.id
      );
    } catch (error) {
      console.error(
        "❌ ERROR COMPLETO EN HANDLE INCOMING:"
      );

      console.error(
        error.response?.data ||
          error.stack ||
          error.message ||
          error
      );
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
  void processMessages(messages);
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};