const express = require("express");

const env = require("../config/env");

const {
  requireAdmin,
  requireAdminPage,
} = require("../middleware/requireAdmin");

const {
  safeEqual,
} = require("../middleware/security");
const { getLegacyCatalogTenant } = require("../services/catalogTenantService");

const {
  showPanel,
  getActiveOrders,
  getHistory,
  getDashboard,
  changeOrderState,
} = require("../controllers/panelController");

const router = express.Router();

/* =========================
   PROTEGER API DEL PANEL
========================= */

function protectPanel(req, res, next) {
  const receivedKey =
    req.get("x-api-key") || "";

  if (
    env.PANEL_API_KEY &&
    safeEqual(
      receivedKey,
      env.PANEL_API_KEY
    )
  ) {
    return getLegacyCatalogTenant()
      .then(tenant => {
        req.tenantId = tenant._id;
        req.tenant = tenant;
        return next();
      })
      .catch(next);
  }

  return requireAdmin(req, res, next);
}

/* =========================
   PÁGINA DEL PANEL
========================= */

router.get("/", (_req, res) => {
  return res.redirect("/panel");
});

router.get(
  "/panel",
  requireAdminPage,
  showPanel
);

/* =========================
   API PROTEGIDA
========================= */

router.get(
  "/api/pedidos",
  protectPanel,
  getActiveOrders
);

router.get(
  "/api/historial",
  protectPanel,
  getHistory
);

router.get(
  "/api/dashboard",
  protectPanel,
  getDashboard
);

router.post(
  "/api/pedido/a-cocina",
  protectPanel,
  (req, _res, next) => {
    req.params.action = "cocina";
    return next();
  },
  changeOrderState
);

router.post(
  "/api/pedido/en-camino",
  protectPanel,
  (req, _res, next) => {
    req.params.action = "en_camino";
    return next();
  },
  changeOrderState
);

router.post(
  "/api/pedido/entregado",
  protectPanel,
  (req, _res, next) => {
    req.params.action = "entregado";
    return next();
  },
  changeOrderState
);

router.post(
  "/api/pedido/cancelar",
  protectPanel,
  (req, _res, next) => {
    req.params.action = "cancelado";
    return next();
  },
  changeOrderState
);

router.post(
  "/api/pedido/:action",
  protectPanel,
  changeOrderState
);

module.exports = router;
