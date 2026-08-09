const mongoose = require("mongoose");

const Producto = require("../models/Producto");

function cleanProductPayload(body = {}) {
  return {
    name: String(
      body.name ??
      body.nombre ??
      ""
    ).trim(),

    category: String(
      body.category ??
      body.categoria ??
      ""
    ).trim(),

    price: Number(
      body.price ??
      body.precio
    ),

    type:
      body.type === "drink"
        ? "drink"
        : "food",

    description: String(
      body.description ??
      body.descripcion ??
      ""
    ).trim(),

    imageUrl: String(
      body.imageUrl ??
      body.imagen ??
      ""
    ).trim(),

    active:
      body.active ??
      body.activo ??
      true,
  };
}

function validateProduct(payload) {
  if (!payload.name) {
    return "El nombre es obligatorio.";
  }

  if (!payload.category) {
    return "La categoría es obligatoria.";
  }

  if (
    !Number.isFinite(payload.price) ||
    payload.price < 0
  ) {
    return "El precio no es válido.";
  }

  return null;
}

/* =========================
   LISTAR PRODUCTOS
========================= */

async function listProducts(
  _req,
  res
) {
  try {
    const productos =
      await Producto.find()
        .sort({
          category: 1,
          order: 1,
          name: 1,
        })
        .lean();

    return res.json({
      ok: true,
      productos,
    });
  } catch (error) {
    console.error(
      "❌ Error listando productos:",
      error.stack ||
      error.message ||
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible obtener los productos.",
    });
  }
}

/* =========================
   CREAR PRODUCTO
========================= */

async function createProduct(
  req,
  res
) {
  try {
    const payload =
      cleanProductPayload(req.body);

    const validationError =
      validateProduct(payload);

    if (validationError) {
      return res.status(400).json({
        ok: false,
        error: validationError,
      });
    }

    const producto =
      await Producto.create(payload);

    return res.status(201).json({
      ok: true,
      producto,
    });
  } catch (error) {
    console.error(
      "❌ Error creando producto:",
      error.stack ||
      error.message ||
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible crear el producto.",
    });
  }
}

/* =========================
   ACTUALIZAR PRODUCTO
========================= */

async function updateProduct(
  req,
  res
) {
  try {
    if (
      !mongoose.isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "El identificador del producto no es válido.",
      });
    }

    const payload =
      cleanProductPayload(req.body);

    const validationError =
      validateProduct(payload);

    if (validationError) {
      return res.status(400).json({
        ok: false,
        error: validationError,
      });
    }

    const producto =
      await Producto.findByIdAndUpdate(
        req.params.id,
        payload,
        {
          new: true,
          runValidators: true,
        }
      );

    if (!producto) {
      return res.status(404).json({
        ok: false,
        error:
          "Producto no encontrado.",
      });
    }

    return res.json({
      ok: true,
      producto,
    });
  } catch (error) {
    console.error(
      "❌ Error actualizando producto:",
      error.stack ||
      error.message ||
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible actualizar el producto.",
    });
  }
}

/* =========================
   ELIMINAR PRODUCTO
========================= */

async function deleteProduct(
  req,
  res
) {
  try {
    if (
      !mongoose.isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "El identificador del producto no es válido.",
      });
    }

    const producto =
      await Producto.findByIdAndDelete(
        req.params.id
      );

    if (!producto) {
      return res.status(404).json({
        ok: false,
        error:
          "Producto no encontrado.",
      });
    }

    return res.json({
      ok: true,
      mensaje:
        "Producto eliminado correctamente.",
    });
  } catch (error) {
    console.error(
      "❌ Error eliminando producto:",
      error.stack ||
      error.message ||
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible eliminar el producto.",
    });
  }
}

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};