function logWebhookEvent(
  level,
  event,
  details = {}
) {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...(details.messageId
      ? { messageId: String(details.messageId).slice(0, 160) }
      : {}),
    ...(details.attempts !== undefined
      ? { attempts: Number(details.attempts) }
      : {}),
    ...(details.error
      ? { error: details.error }
      : {}),
  };

  const writer = console[level] || console.log;
  writer(JSON.stringify(payload));
}

module.exports = {
  logWebhookEvent,
};
