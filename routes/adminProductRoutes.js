const express = require("express");

const {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/adminProductController");

const router = express.Router();

/* =========================
   LISTAR PRODUCTOS
========================= */

router.get(
  "/",
  listProducts
);

/* =========================
   CREAR PRODUCTO
========================= */

router.post(
  "/",
  createProduct
);

/* =========================
   ACTUALIZAR PRODUCTO
========================= */

router.put(
  "/:id",
  updateProduct
);

/* =========================
   ELIMINAR PRODUCTO
========================= */

router.delete(
  "/:id",
  deleteProduct
);

module.exports = router;