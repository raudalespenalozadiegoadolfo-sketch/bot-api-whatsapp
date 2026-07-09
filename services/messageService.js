const ProcessedMessage = require("../models/ProcessedMessage");

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
  return (
    body.entry?.flatMap(entry => entry.changes || [])
      .flatMap(change => change.value?.messages || []) || []
  );
}

module.exports = {
  alreadyProcessed,
  getMessagesFromWebhook,
};