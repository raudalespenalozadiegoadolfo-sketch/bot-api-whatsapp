async function verifyWebhook(req, res) {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token === process.env.VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
}

async function receiveWebhook(req, res) {
  try {
    // Aquí moveremos todo el handleIncoming() del server.js
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};