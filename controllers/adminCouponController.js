const mongoose = require("mongoose");

const Cupon = require(
  "../models/Cupon"
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
   LIMPIAR CÓDIGO
========================= */

function cleanCode(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

/* =========================
   NÚMERO OPCIONAL
========================= */

function optionalNumber(
  value
) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

/* =========================
   FECHA OPCIONAL
========================= */

function optionalDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

/* =========================
   LIMPIAR PAYLOAD
========================= */

function cleanCouponPayload(
  body = {}
) {
  return {
    code:
      cleanCode(
        body.code
      ).slice(
        0,
        40
      ),

    description:
      cleanText(
        body.description
      ).slice(
        0,
        250
      ),

    type:
      body.type === "fixed"
        ? "fixed"
        : "percent",

    value:
      Number(
        body.value
      ),

    minimumPurchase:
      Number(
        body.minimumPurchase ||
        0
      ),

    maxDiscount:
      optionalNumber(
        body.maxDiscount
      ),

    startsAt:
      optionalDate(
        body.startsAt
      ),

    expiresAt:
      optionalDate(
        body.expiresAt
      ),

    active:
      body.active !== false,

    usageLimit:
      optionalNumber(
        body.usageLimit
      ),

    perCustomerLimit:
      optionalNumber(
        body.perCustomerLimit
      ),

    order:
      Number(
        body.order ||
        0
      ),
  };
}

/* =========================
   VALIDAR PAYLOAD
========================= */

function validatePayload(
  payload
) {
  if (!payload.code) {
    throw new Error(
      "El código del cupón es obligatorio."
    );
  }

  if (
    !Number.isFinite(
      payload.value
    ) ||
    payload.value <= 0
  ) {
    throw new Error(
      "El valor del cupón debe ser mayor a 0."
    );
  }

  if (
    payload.type ===
      "percent" &&
    payload.value > 100
  ) {
    throw new Error(
      "El porcentaje no puede ser mayor a 100."
    );
  }

  if (
    !Number.isFinite(
      payload.minimumPurchase
    ) ||
    payload.minimumPurchase < 0
  ) {
    throw new Error(
      "La compra mínima no es válida."
    );
  }

  if (
    payload.maxDiscount !==
      null &&
    (
      !Number.isFinite(
        payload.maxDiscount
      ) ||
      payload.maxDiscount < 0
    )
  ) {
    throw new Error(
      "El descuento máximo no es válido."
    );
  }

  if (
    payload.usageLimit !==
      null &&
    (
      !Number.isInteger(
        payload.usageLimit
      ) ||
      payload.usageLimit < 1
    )
  ) {
    throw new Error(
      "El límite total de usos debe ser un entero mayor a 0."
    );
  }

  if (
    payload.perCustomerLimit !==
      null &&
    (
      !Number.isInteger(
        payload.perCustomerLimit
      ) ||
      payload.perCustomerLimit < 1
    )
  ) {
    throw new Error(
      "El límite por cliente debe ser un entero mayor a 0."
    );
  }

  if (
    payload.startsAt &&
    payload.expiresAt &&
    payload.expiresAt <
      payload.startsAt
  ) {
    throw new Error(
      "La fecha de vencimiento no puede ser anterior a la fecha de inicio."
    );
  }
}

/* =========================
   LISTAR CUPONES
========================= */

async function listCoupons(
  _req,
  res
) {
  try {
    const coupons =
      await Cupon.find()
        .sort({
          order: 1,
          createdAt: -1,
        })
        .lean();

    return res.json({
      ok: true,
      coupons,
    });
  } catch (error) {
    console.error(
      "❌ Error obteniendo cupones:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "No fue posible obtener los cupones.",
      });
  }
}

/* =========================
   CREAR CUPÓN
========================= */

async function createCoupon(
  req,
  res
) {
  try {
    const payload =
      cleanCouponPayload(
        req.body
      );

    validatePayload(
      payload
    );

    const existing =
      await Cupon.findOne({
        code:
          payload.code,
      }).lean();

    if (existing) {
      return res
        .status(409)
        .json({
          ok: false,
          error:
            "Ya existe un cupón con ese código.",
        });
    }

    const coupon =
      await Cupon.create({
        ...payload,
        timesUsed: 0,
        customerUsage: [],
      });

    return res
      .status(201)
      .json({
        ok: true,
        coupon,
      });
  } catch (error) {
    console.error(
      "❌ Error creando cupón:",
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
          "No fue posible crear el cupón.",
      });
  }
}

/* =========================
   ACTUALIZAR CUPÓN
========================= */

async function updateCoupon(
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
            "El identificador del cupón no es válido.",
        });
    }

    const payload =
      cleanCouponPayload(
        req.body
      );

    validatePayload(
      payload
    );

    const duplicate =
      await Cupon.findOne({
        _id: {
          $ne:
            req.params.id,
        },

        code:
          payload.code,
      }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({
          ok: false,
          error:
            "Ya existe otro cupón con ese código.",
        });
    }

    /*
     * No tocamos timesUsed
     * ni customerUsage.
     */
    const coupon =
      await Cupon.findByIdAndUpdate(
        req.params.id,
        {
          $set: payload,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!coupon) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Cupón no encontrado.",
        });
    }

    return res.json({
      ok: true,
      coupon,
    });
  } catch (error) {
    console.error(
      "❌ Error actualizando cupón:",
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
          "No fue posible actualizar el cupón.",
      });
  }
}

/* =========================
   ACTIVAR / DESACTIVAR
========================= */

async function toggleCoupon(
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
            "El identificador del cupón no es válido.",
        });
    }

    const coupon =
      await Cupon.findById(
        req.params.id
      );

    if (!coupon) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Cupón no encontrado.",
        });
    }

    coupon.active =
      !coupon.active;

    await coupon.save();

    return res.json({
      ok: true,
      coupon,
    });
  } catch (error) {
    console.error(
      "❌ Error cambiando estado del cupón:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "No fue posible cambiar el estado del cupón.",
      });
  }
}

/* =========================
   ELIMINAR CUPÓN
========================= */

async function deleteCoupon(
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
            "El identificador del cupón no es válido.",
        });
    }

    const coupon =
      await Cupon.findByIdAndDelete(
        req.params.id
      );

    if (!coupon) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Cupón no encontrado.",
        });
    }

    return res.json({
      ok: true,
      mensaje:
        "Cupón eliminado correctamente.",
    });
  } catch (error) {
    console.error(
      "❌ Error eliminando cupón:",
      error.stack ||
        error.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "No fue posible eliminar el cupón.",
      });
  }
}

/* =========================
   EXPORTAR
========================= */

module.exports = {
  listCoupons,
  createCoupon,
  updateCoupon,
  toggleCoupon,
  deleteCoupon,
};