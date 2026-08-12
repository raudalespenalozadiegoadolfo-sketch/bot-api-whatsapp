const path = require("node:path");

function resolveFromProject(modulePath) {
  return require.resolve(path.resolve(__dirname, "..", modulePath));
}

function loadWithMocks(modulePath, mocks = {}) {
  const target = resolveFromProject(modulePath);
  const previous = new Map();
  for (const [mockPath, exports] of Object.entries(mocks)) {
    const resolved = resolveFromProject(mockPath);
    previous.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  delete require.cache[target];
  const loaded = require(target);
  return {
    loaded,
    restore() {
      delete require.cache[target];
      for (const [resolved, cached] of previous.entries()) {
        if (cached) require.cache[resolved] = cached;
        else delete require.cache[resolved];
      }
    },
  };
}

function responseRecorder() {
  return {
    statusCode: 200, body: undefined, sent: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.sent = body; return this; },
    sendStatus(code) { this.statusCode = code; this.sent = code; return this; },
    set(headers) { Object.assign(this.headers, headers); return this; },
  };
}

module.exports = { loadWithMocks, responseRecorder };
