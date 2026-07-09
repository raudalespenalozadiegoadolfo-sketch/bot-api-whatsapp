const express = require("express");
const router = express.Router();

const webhookController = require("../controllers/webhookController");

// Verificación de Meta
router.get("/webhook", webhookController.verifyWebhook);

// Recepción de mensajes
// router.post("/webhook", webhookController.receiveWebhook);

module.exports = router;