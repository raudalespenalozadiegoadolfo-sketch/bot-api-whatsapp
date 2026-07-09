const crypto = require("crypto");
const env = require("../config/env");

function verifyWebhook(req, res) {
  const valid =
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === env.VERIFY_TOKEN;

  return valid
    ? res.status(200).send(req.query["hub.challenge"])
    : res.sendStatus(403);
}

function validateSignature(req) {
  const receivedSignature = req.get("x-hub-signature-256") || "";

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", env.APP_SECRET)
    .update(req.rawBody || Buffer.from(""))
    .digest("hex")}`;

  return (
    receivedSignature.length === expectedSignature.length &&
    crypto.timingSafeEqual(
      Buffer.from(receivedSignature),
      Buffer.from(expectedSignature)
    )
  );
}

async function receiveWebhook(req, res) {
  const signatureIsValid = validateSignature(req);

  if (!signatureIsValid) {
    return res.sendStatus(401);
  }

  const messages =
    req.body.entry?.flatMap(entry => entry.changes || [])
      .flatMap(change => change.value?.messages || []) || [];

  res.sendStatus(200);

  console.log("Mensajes recibidos por nuevo controlador:", messages.length);

  // En el siguiente paso conectaremos handleIncoming aquí.
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};