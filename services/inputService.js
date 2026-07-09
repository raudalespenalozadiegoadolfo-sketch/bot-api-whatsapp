function extractInput(message) {
  if (message.type === "text") {
    return {
      kind: "text",
      value: message.text.body.trim(),
    };
  }

  if (message.type === "location") {
    return {
      kind: "location",
      value: message.location,
    };
  }

  const interactive = message.interactive;

  if (interactive?.button_reply) {
    return {
      kind: "button",
      value: interactive.button_reply.id,
    };
  }

  if (interactive?.list_reply) {
    return {
      kind: "list",
      value: interactive.list_reply.id,
    };
  }

  return {
    kind: "unsupported",
    value: "",
  };
}

module.exports = {
  extractInput,
};