const express = require("express");
const router = express.Router();

const {
  showStore,
  getMenu,
  createStoreOrder,
} = require("../controllers/storeController");

const CHECKOUT_WINDOW_MS =
  60 * 1000;

const CHECKOUT_MAX_REQUESTS = 5;

function checkoutRateLimit(
  req,
  res,
  next
) {
  const now = Date.now();
  const key = req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  const store =
    req.app.locals.checkoutRateLimit ||
    new Map();

  req.app.locals.checkoutRateLimit =
    store;

  const current = store.get(key);

  if (
    !current ||
    now - current.startedAt >=
      CHECKOUT_WINDOW_MS
  ) {
    store.set(key, {
      startedAt: now,
      count: 1,
    });

    return next();
  }

  if (
    current.count >=
    CHECKOUT_MAX_REQUESTS
  ) {
    res.set(
      "Retry-After",
      String(
        Math.ceil(
          (
            CHECKOUT_WINDOW_MS -
            (now - current.startedAt)
          ) / 1000
        )
      )
    );

    return res.status(429).json({
      error:
        "Demasiadas solicitudes. Intenta nuevamente en un minuto.",
    });
  }

  current.count += 1;

  return next();
}

router.get("/tienda", showStore);
router.get("/api/menu", getMenu);
router.post(
  "/api/tienda/pedido",
  checkoutRateLimit,
  createStoreOrder
);

module.exports = router;
