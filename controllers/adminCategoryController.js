const Categoria = require("../models/Categoria");

/* =========================
   LIMPIAR NOMBRE
========================= */

function cleanCategoryName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

/* =========================
   NORMALIZAR NOMBRE
========================= */

function normalizeCategoryName(value) {
  return cleanCategoryName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* =========================
   LISTAR CATEGORÍAS
========================= */

async function listCategories(
  req,
  res
) {
  try {
    const categorias =
      await Categoria.find({
        tenantId: req.tenantId,
        active: {
          $ne: false,
        },
      })
        .sort({
          order: 1,
          name: 1,
        })
        .lean();

    return res.json({
      ok: true,
      categorias,
    });
  } catch (error) {
    console.error(
      "❌ Error obteniendo categorías:",
      error.stack ||
        error.message ||
        error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible obtener las categorías.",
    });
  }
}

/* =========================
   CREAR CATEGORÍA
========================= */

async function createCategory(
  req,
  res
) {
  try {
    const name =
      cleanCategoryName(
        req.body?.name
      );

    if (!name) {
      return res.status(400).json({
        ok: false,
        error:
          "Escribe el nombre de la categoría.",
      });
    }

    const normalizedName =
      normalizeCategoryName(name);

    const existing =
      await Categoria.findOne({
        tenantId: req.tenantId,
        normalizedName,
      });

    if (existing) {
      if (!existing.active) {
        existing.active = true;
        existing.name = name;

        await existing.save();
      }

      return res.json({
        ok: true,
        categoria: existing,
        existing: true,
      });
    }

    const categoria =
      await Categoria.create({
        tenantId: req.tenantId,
        name,
        normalizedName,
        active: true,
      });

    return res.status(201).json({
      ok: true,
      categoria,
    });
  } catch (error) {
    console.error(
      "❌ Error creando categoría:",
      error.stack ||
        error.message ||
        error
    );

    if (error.code === 11000) {
      return res.status(409).json({
        ok: false,
        error:
          "La categoría ya existe.",
      });
    }

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible crear la categoría.",
    });
  }
}

module.exports = {
  listCategories,
  createCategory,
};
