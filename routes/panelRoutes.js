const express = require("express");

const env = require("../config/env");

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
  if (!env.PANEL_API_KEY) {
    return next();
  }

  const receivedKey =
    req.get("x-api-key") || "";

  if (
    receivedKey === env.PANEL_API_KEY
  ) {
    return next();
  }

  return res.status(401).json({
    error: "No autorizado",
  });
}

/* =========================
   PÁGINA DEL PANEL
========================= */

router.get("/", (_req, res) => {
  return res.redirect("/panel");
});

router.get("/panel", showPanel);

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