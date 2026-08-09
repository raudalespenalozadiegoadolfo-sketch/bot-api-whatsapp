const express = require("express");

const {
  listCategories,
  createCategory,
} = require(
  "../controllers/adminCategoryController"
);

const router = express.Router();

/* =========================
   LISTAR CATEGORÍAS
========================= */

router.get(
  "/",
  listCategories
);

/* =========================
   CREAR CATEGORÍA
========================= */

router.post(
  "/",
  createCategory
);

module.exports = router;