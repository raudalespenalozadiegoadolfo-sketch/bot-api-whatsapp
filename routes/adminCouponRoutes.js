const express = require("express");

const {
  listCoupons,
  createCoupon,
  updateCoupon,
  toggleCoupon,
  deleteCoupon,
} = require(
  "../controllers/adminCouponController"
);

const router = express.Router();

/* =========================
   LISTAR CUPONES
========================= */

router.get(
  "/",
  listCoupons
);

/* =========================
   CREAR CUPÓN
========================= */

router.post(
  "/",
  createCoupon
);

/* =========================
   ACTUALIZAR CUPÓN
========================= */

router.put(
  "/:id",
  updateCoupon
);

/* =========================
   ACTIVAR / DESACTIVAR
========================= */

router.patch(
  "/:id/toggle",
  toggleCoupon
);

/* =========================
   ELIMINAR CUPÓN
========================= */

router.delete(
  "/:id",
  deleteCoupon
);

module.exports = router;