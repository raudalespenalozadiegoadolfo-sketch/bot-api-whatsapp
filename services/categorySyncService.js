const Categoria = require("../models/Categoria");

const {
  products,
} = require("./menuService");

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
   SINCRONIZAR CATEGORÍAS
========================= */

async function syncLegacyCategories() {
  const categoryNames = [
    ...new Set(
      products
        .map(product =>
          cleanCategoryName(
            product.category
          )
        )
        .filter(Boolean)
    ),
  ];

  let created = 0;
  let existing = 0;
  let reactivated = 0;

  for (
    let index = 0;
    index < categoryNames.length;
    index += 1
  ) {
    const name =
      categoryNames[index];

    const normalizedName =
      normalizeCategoryName(name);

    const category =
      await Categoria.findOne({
        normalizedName,
      });

    if (category) {
      existing += 1;

      let changed = false;

      if (!category.active) {
        category.active = true;
        reactivated += 1;
        changed = true;
      }

      if (
        typeof category.order !== "number"
      ) {
        category.order = index;
        changed = true;
      }

      if (changed) {
        await category.save();
      }

      continue;
    }

    await Categoria.create({
      name,
      normalizedName,
      active: true,
      order: index,
    });

    created += 1;
  }

  console.log(
    `✅ Categorías sincronizadas: ${created} nuevas, ${existing} existentes, ${reactivated} reactivadas.`
  );

  return {
    created,
    existing,
    reactivated,
    total: categoryNames.length,
  };
}

/* =========================
   EXPORTAR
========================= */

module.exports = {
  syncLegacyCategories,
};