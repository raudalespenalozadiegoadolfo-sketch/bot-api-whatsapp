const express = require("express");
const router = express.Router();

const {
  showStore,
  getMenu,
  createStoreOrder,
} = require("../controllers/storeController");
const { getLegacyCatalogTenant } = require("../services/catalogTenantService");
const { resolveStorefront, resolveStorefrontBranch } = require("../services/storefrontService");

async function legacyStorefront(req, res, next) {
  try {
    req.storefrontTenant = await getLegacyCatalogTenant();
    req.storefrontBranch = await resolveStorefrontBranch(req.storefrontTenant._id);
    req.storefrontLegacyAlias = true;
    return next();
  } catch (error) { return next(error); }
}

async function storefrontContext(req, res, next) {
  try {
    const tenant = await resolveStorefront(req.params.storefrontKey);
    if (!tenant) return res.status(404).json({ ok: false, error: "Tienda no encontrada." });
    req.storefrontTenant = tenant;
    req.storefrontBranch = await resolveStorefrontBranch(tenant._id);
    return next();
  } catch (error) { return next(error); }
}

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

router.get("/tienda", legacyStorefront, showStore);
router.get("/tienda/:storefrontKey", storefrontContext, showStore);
router.get("/api/menu", legacyStorefront, getMenu);
router.get("/api/store/:storefrontKey/menu", storefrontContext, getMenu);
router.post(
  "/api/tienda/pedido",
  legacyStorefront,
  checkoutRateLimit,
  createStoreOrder
);
router.post(
  "/api/store/:storefrontKey/pedido",
  storefrontContext,
  checkoutRateLimit,
  createStoreOrder
);

module.exports = router;
