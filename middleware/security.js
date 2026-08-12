const crypto = require("crypto");
const env = require("../config/env");

const loginAttempts = new Map();

const LOGIN_WINDOW_MS = Number(
  process.env.LOGIN_RATE_WINDOW_MS ||
    15 * 60 * 1000
);

const LOGIN_MAX_FAILURES = Number(
  process.env.LOGIN_RATE_MAX_FAILURES || 5
);

const MAX_LOGIN_KEYS = 10000;

function loginRateLimit(req, res, next) {
  if (req.session?.usuario) {
    return next();
  }

  const now = Date.now();
  const key = req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  for (const [storedKey, entry] of loginAttempts) {
    if (now - entry.startedAt >= LOGIN_WINDOW_MS) {
      loginAttempts.delete(storedKey);
    }
  }

  const current = loginAttempts.get(key);

  if (
    current &&
    current.failures >= LOGIN_MAX_FAILURES
  ) {
    res.set("Retry-After", String(Math.ceil(
      (LOGIN_WINDOW_MS - (now - current.startedAt)) / 1000
    )));
    return res.status(429).json({
      ok: false,
      error: "Demasiados intentos. Intenta nuevamente más tarde.",
    });
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      loginAttempts.delete(key);
      return;
    }

    if (res.statusCode !== 401) return;
    const entry = loginAttempts.get(key);
    if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
      if (loginAttempts.size >= MAX_LOGIN_KEYS) {
        loginAttempts.delete(loginAttempts.keys().next().value);
      }
      loginAttempts.set(key, { startedAt: now, failures: 1 });
      return;
    }
    entry.failures += 1;
  });

  return next();
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first || ""));
  const b = Buffer.from(String(second || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrfToken(req, res) {
  return res.json({
    ok: true,
    csrfToken: ensureCsrfToken(req),
  });
}

function csrfProtection(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const protectedPath =
    req.path.startsWith("/api/admin/") ||
    req.path.startsWith("/api/pedido/") ||
    req.path === "/api/auth/logout";

  if (!protectedPath) return next();

  const configuredKey = env.PANEL_API_KEY || "";
  const receivedKey = req.get("x-api-key") || "";
  if (configuredKey && safeEqual(configuredKey, receivedKey)) {
    return next();
  }

  const receivedToken = req.get("x-csrf-token") || "";
  const expectedToken = req.session?.csrfToken || "";
  if (expectedToken && safeEqual(expectedToken, receivedToken)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    error: "Token CSRF inválido o ausente.",
  });
}

function securityHeaders(_req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  });
  return next();
}

module.exports = {
  csrfProtection,
  csrfToken,
  ensureCsrfToken,
  loginRateLimit,
  safeEqual,
  securityHeaders,
};
