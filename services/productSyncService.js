const Producto =
  require("../models/Producto");

const {
  products,
} = require("./menuService");

function cleanText(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(/\s+/g, " ");
}

async function syncLegacyProducts(tenant) {
  if (!tenant?._id) throw new Error("Se requiere el tenant legacy para sincronizar productos.");
  let created = 0;
  let updated = 0;
  let existing = 0;

  for (
    let index = 0;
    index < products.length;
    index += 1
  ) {
    const product =
      products[index];

    const legacyId =
      String(
        product.id || ""
      ).trim();

    const name =
      cleanText(
        product.name
      );

    const category =
      cleanText(
        product.category
      );

    const price =
      Number(
        product.price || 0
      );

    if (
      !name ||
      !category ||
      !Number.isFinite(price)
    ) {
      continue;
    }

    /*
     * Primero intentamos localizarlo
     * por legacyId.
     */
    let existingProduct = null;

    if (legacyId) {
      existingProduct =
        await Producto.findOne({
          tenantId: tenant._id,
          legacyId,
        });
    }

    /*
     * Si todavía no existe por ID,
     * buscamos mismo nombre +
     * categoría.
     */
    if (!existingProduct) {
      existingProduct =
        await Producto.findOne({
          tenantId: tenant._id,
          name: {
            $regex:
              `^${escapeRegex(name)}$`,
            $options: "i",
          },

          category: {
            $regex:
              `^${escapeRegex(category)}$`,
            $options: "i",
          },
        });
    }

    if (existingProduct) {
      let changed = false;

      /*
       * Guardamos el legacyId para
       * futuras sincronizaciones.
       */
      if (
        legacyId &&
        !existingProduct.legacyId
      ) {
        existingProduct.legacyId =
          legacyId;

        changed = true;
      }

      /*
       * NO modificamos precio/nombre
       * si ya fue creado o editado
       * desde el administrador.
       *
       * Solo actualizamos automáticamente
       * productos provenientes del menú
       * antiguo.
       */
      if (
        existingProduct.source ===
        "legacy"
      ) {
        existingProduct.name =
          name;

        existingProduct.category =
          category;

        existingProduct.price =
          price;

        existingProduct.type =
          product.type === "drink"
            ? "drink"
            : "food";

        existingProduct.aliases =
          Array.isArray(
            product.aliases
          )
            ? product.aliases
            : [];

        existingProduct.order =
          index;

        changed = true;
      }

      if (changed) {
        await existingProduct.save();

        updated += 1;
      } else {
        existing += 1;
      }

      continue;
    }

    await Producto.create({
      tenantId: tenant._id,
      legacyId,

      name,

      category,

      price,

      type:
        product.type === "drink"
          ? "drink"
          : "food",

      description:
        product.description ||
        "",

      imageUrl:
        product.imageUrl ||
        "",

      aliases:
        Array.isArray(
          product.aliases
        )
          ? product.aliases
          : [],

      active: true,

      order: index,

      source: "legacy",
    });

    created += 1;
  }

  console.log(
    `✅ Productos sincronizados: ${created} nuevos, ${updated} actualizados, ${existing} existentes.`
  );

  return {
    created,
    updated,
    existing,
    total: products.length,
  };
}

function escapeRegex(value) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}

module.exports = {
  syncLegacyProducts,
};
