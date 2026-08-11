const mongoose = require("mongoose");

const Combo = require(
  "../models/Combo"
);

const Producto = require(
  "../models/Producto"
);

/* =========================
   LIMPIAR TEXTO
========================= */

function cleanText(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(/\s+/g, " ");
}

/* =========================
   LIMPIAR PAYLOAD
========================= */

function cleanComboPayload(
  body = {}
) {
  const rawItems =
    Array.isArray(body.items)
      ? body.items
      : [];

  const items =
    rawItems.map(item => {
      const mode =
        item.mode === "category"
          ? "category"
          : "product";

      const cantidad =
        Math.min(
          Math.max(
            Math.trunc(
              Number(
                item.cantidad || 1
              )
            ),
            1
          ),
          20
        );

      /* =====================
         CATEGORÍA
      ===================== */

      if (
        mode === "category"
      ) {
        const excludedProductIds =
          Array.isArray(
            item.excludedProductIds
          )
            ? item.excludedProductIds
                .map(id =>
                  String(
                    id || ""
                  ).trim()
                )
                .filter(id =>
                  mongoose.isValidObjectId(
                    id
                  )
                )
            : [];

        return {
          mode:
            "category",

          productId:
            null,

          category:
            cleanText(
              item.category
            ),

          excludedProductIds,

          label:
            cleanText(
              item.label
            ),

          cantidad,
        };
      }

      /* =====================
         PRODUCTO ESPECÍFICO
      ===================== */

      return {
        mode:
          "product",

        productId:
          cleanText(
            item.productId
          ),

        category:
          "",

        excludedProductIds:
          [],

        label:
          cleanText(
            item.label
          ),

        cantidad,
      };
    });

  return {
    name:
      cleanText(
        body.name
      ).slice(
        0,
        120
      ),

    description:
      cleanText(
        body.description
      ).slice(
        0,
        500
      ),

    items,

    comboPrice:
      Number(
        body.comboPrice
      ),

    imageUrl:
      cleanText(
        body.imageUrl
      ),

    active:
      body.active !== false,
  };
}

/* =========================
   VALIDAR ITEMS
========================= */

async function validateAndPrepareItems(
  items
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    throw new Error(
      "Selecciona al menos un producto o categoría."
    );
  }

  const prepared = [];

  for (
    const item
    of items
  ) {

    /* =====================
       PRODUCTO ESPECÍFICO
    ===================== */

    if (
      item.mode ===
      "product"
    ) {
      if (
        !mongoose.isValidObjectId(
          item.productId
        )
      ) {
        throw new Error(
          "Hay un producto inválido en el combo."
        );
      }

      const product =
        await Producto.findOne({
          _id:
            item.productId,

          active: {
            $ne: false,
          },
        }).lean();

      if (!product) {
        throw new Error(
          "Uno de los productos seleccionados ya no está disponible."
        );
      }

      prepared.push({
        mode:
          "product",

        productId:
          product._id,

        category:
          "",

        excludedProductIds:
          [],

        label:
          item.label || "",

        cantidad:
          item.cantidad,

        referencePrice:
          Number(
            product.price || 0
          ),
      });

      continue;
    }

    /* =====================
       CATEGORÍA COMPLETA
    ===================== */

    const category =
      cleanText(
        item.category
      );

    if (!category) {
      throw new Error(
        "Selecciona una categoría."
      );
    }

    /*
     * Consulta base:
     * productos activos de la categoría.
     */
    const query = {
      category: {
        $regex:
          `^${escapeRegex(
            category
          )}$`,

        $options:
          "i",
      },

      active: {
        $ne: false,
      },
    };

    /*
     * Si el administrador excluyó
     * productos, no se toman en cuenta.
     */
    if (
      Array.isArray(
        item.excludedProductIds
      ) &&
      item.excludedProductIds.length
    ) {
      query._id = {
        $nin:
          item.excludedProductIds,
      };
    }

    const categoryProducts =
      await Producto.find(
        query
      )
        .sort({
          price: 1,
          name: 1,
        })
        .lean();

    if (
      !categoryProducts.length
    ) {
      throw new Error(
        `La categoría "${category}" no tiene productos disponibles después de aplicar las exclusiones.`
      );
    }

    /*
     * Usamos el producto permitido
     * más económico como referencia.
     */
    const minimumPrice =
      Math.min(
        ...categoryProducts.map(
          product =>
            Number(
              product.price || 0
            )
        )
      );

    prepared.push({
      mode:
        "category",

      productId:
        null,

      category,

      excludedProductIds:
        item.excludedProductIds ||
        [],

      label:
        item.label ||
        `Elige ${category}`,

      cantidad:
        item.cantidad,

      referencePrice:
        minimumPrice,
    });
  }

  return prepared;
}

/* =========================
   PRECIO NORMAL
========================= */

function calculateNormalPrice(
  preparedItems
) {
  return preparedItems.reduce(
    (
      total,
      item
    ) =>
      total +
      Number(
        item.referencePrice ||
        0
      ) *
      Number(
        item.cantidad ||
        1
      ),

    0
  );
}

/* =========================
   QUITAR DATOS AUXILIARES
========================= */

function cleanPreparedItems(
  items
) {
  return items.map(
    item => ({
      mode:
        item.mode,

      productId:
        item.productId ||
        null,

      category:
        item.category ||
        "",

      excludedProductIds:
        item.excludedProductIds ||
        [],

      label:
        item.label ||
        "",

      cantidad:
        item.cantidad,
    })
  );
}

/* =========================
   LISTAR COMBOS
========================= */

async function listCombos(
  _req,
  res
) {
  try {
    const combos =
      await Combo.find()
        .sort({
          order: 1,
          name: 1,
        })
        .populate({
          path:
            "items.productId",

          select:
            "name category price active imageUrl",
        })
        .lean();

    return res.json({
      ok: true,
      combos,
    });
  } catch (error) {
    console.error(
      "❌ Error obteniendo combos:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          "No fue posible obtener los combos.",
      });
  }
}

/* =========================
   CREAR COMBO
========================= */

async function createCombo(
  req,
  res
) {
  try {
    const payload =
      cleanComboPayload(
        req.body
      );

    if (!payload.name) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El nombre del combo es obligatorio.",
        });
    }

    if (
      !Number.isFinite(
        payload.comboPrice
      ) ||
      payload.comboPrice < 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El precio del combo no es válido.",
        });
    }

    const preparedItems =
      await validateAndPrepareItems(
        payload.items
      );

    const normalPrice =
      calculateNormalPrice(
        preparedItems
      );

    const combo =
      await Combo.create({
        name:
          payload.name,

        description:
          payload.description,

        items:
          cleanPreparedItems(
            preparedItems
          ),

        normalPrice,

        comboPrice:
          payload.comboPrice,

        imageUrl:
          payload.imageUrl,

        active:
          payload.active,
      });

    return res
      .status(201)
      .json({
        ok: true,
        combo,
      });
  } catch (error) {
    console.error(
      "❌ Error creando combo:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(400)
      .json({
        ok: false,

        error:
          error.message ||
          "No fue posible crear el combo.",
      });
  }
}

/* =========================
   ACTUALIZAR COMBO
========================= */

async function updateCombo(
  req,
  res
) {
  try {
    if (
      !mongoose.isValidObjectId(
        req.params.id
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El identificador del combo no es válido.",
        });
    }

    const payload =
      cleanComboPayload(
        req.body
      );

    if (!payload.name) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El nombre del combo es obligatorio.",
        });
    }

    if (
      !Number.isFinite(
        payload.comboPrice
      ) ||
      payload.comboPrice < 0
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El precio del combo no es válido.",
        });
    }

    const preparedItems =
      await validateAndPrepareItems(
        payload.items
      );

    const normalPrice =
      calculateNormalPrice(
        preparedItems
      );

    const combo =
      await Combo.findByIdAndUpdate(
        req.params.id,
        {
          name:
            payload.name,

          description:
            payload.description,

          items:
            cleanPreparedItems(
              preparedItems
            ),

          normalPrice,

          comboPrice:
            payload.comboPrice,

          imageUrl:
            payload.imageUrl,

          active:
            payload.active,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!combo) {
      return res
        .status(404)
        .json({
          ok: false,

          error:
            "Combo no encontrado.",
        });
    }

    return res.json({
      ok: true,
      combo,
    });
  } catch (error) {
    console.error(
      "❌ Error actualizando combo:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(400)
      .json({
        ok: false,

        error:
          error.message ||
          "No fue posible actualizar el combo.",
      });
  }
}

/* =========================
   ELIMINAR COMBO
========================= */

async function deleteCombo(
  req,
  res
) {
  try {
    if (
      !mongoose.isValidObjectId(
        req.params.id
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            "El identificador del combo no es válido.",
        });
    }

    const combo =
      await Combo.findByIdAndDelete(
        req.params.id
      );

    if (!combo) {
      return res
        .status(404)
        .json({
          ok: false,

          error:
            "Combo no encontrado.",
        });
    }

    return res.json({
      ok: true,

      mensaje:
        "Combo eliminado correctamente.",
    });
  } catch (error) {
    console.error(
      "❌ Error eliminando combo:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          "No fue posible eliminar el combo.",
      });
  }
}

/* =========================
   ESCAPAR REGEX
========================= */

function escapeRegex(value) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}

/* =========================
   EXPORTAR
========================= */

module.exports = {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo,
};