const express = require("express");

const {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo,
} = require(
  "../controllers/adminComboController"
);

const router =
  express.Router();

/* =========================
   LISTAR COMBOS
========================= */

router.get(
  "/",
  listCombos
);

/* =========================
   CREAR COMBO
========================= */

router.post(
  "/",
  createCombo
);

/* =========================
   ACTUALIZAR COMBO
========================= */

router.put(
  "/:id",
  updateCombo
);

/* =========================
   ELIMINAR COMBO
========================= */

router.delete(
  "/:id",
  deleteCombo
);

/* =========================
   EXPORTAR ROUTER
========================= */

module.exports = router;