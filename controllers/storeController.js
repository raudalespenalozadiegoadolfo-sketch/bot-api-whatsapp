const path = require("path");

const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");

const {
  products: legacyProducts,
} = require("../services/menuService");

const {
  cleanPhone,
} = require("../services/utilsService");

const {
  addProduct,
  totalOf,
} = require("../services/carritoService");

const {
  ticket,
} = require("../services/ticketService");

const {
  sendText,
  sendButtons,
} = require("../services/whatsappService");

/* =========================
   MOSTRAR TIENDA
========================= */

function showStore(_req, res) {
  return res.sendFile(
    path.join(
      __dirname,
      "..",
      "public",
      "tienda.html"
    )
  );
}

/* =========================
   PRODUCTO DE MONGODB
========================= */

function serializeDatabaseProduct(product) {
  return {
    id: String(product._id),

    name: product.name,

    category: product.category,

    price: Number(product.price),

    type:
      product.type === "drink"
        ? "drink"
        : "food",

    description:
      product.description || "",

    imageUrl:
      product.imageUrl || "",

    aliases: Array.isArray(
      product.aliases
    )
      ? product.aliases
      : [],

    active:
      product.active !== false,

    source: "mongodb",
  };
}

/* =========================
   PRODUCTO ANTERIOR
========================= */

function serializeLegacyProduct(product) {
  return {
    id: String(product.id),

    name: product.name,

    category: product.category,

    price: Number(product.price),

    type:
      product.type === "drink"
        ? "drink"
        : "food",

    description:
      product.description || "",

    imageUrl:
      product.imageUrl || "",

    aliases: Array.isArray(
      product.aliases
    )
      ? product.aliases
      : [],

    active: true,

    source: "legacy",
  };
}

/* =========================
   NORMALIZAR CLAVE
========================= */

function productKey(product) {
  return `${product.category}::${product.name}`
    .trim()
    .toLowerCase();
}

/* =========================
   CARGAR PRODUCTOS
========================= */

async function loadAvailableProducts() {
  const databaseProducts =
    await Producto.find({
      active: {
        $ne: false,
      },
    })
      .sort({
        category: 1,
        order: 1,
        name: 1,
      })
      .lean();

  console.log(
    "📦 Productos activos en MongoDB:",
    databaseProducts.length
  );

  const productMap = new Map();

  legacyProducts
    .map(serializeLegacyProduct)
    .forEach(product => {
      productMap.set(
        productKey(product),
        product
      );
    });

  databaseProducts
    .map(serializeDatabaseProduct)
    .forEach(product => {
      /*
       * Un producto de MongoDB reemplaza al producto
       * anterior cuando coinciden nombre y categoría.
       */
      productMap.set(
        productKey(product),
        product
      );
    });

  return Array.from(
    productMap.values()
  );
}

/* =========================
   OBTENER MENÚ
========================= */

async function getMenu(
  _req,
  res,
  next
) {
  try {
    const products =
      await loadAvailableProducts();

    const categories = [
      ...new Set(
        products
          .map(
            product =>
              product.category
          )
          .filter(Boolean)
      ),
    ];

    res.set({
  "Cache-Control":
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
});

    return res.json({
      ok: true,
      categories,
      products,
    });
  } catch (error) {
    console.error(
      "❌ Error cargando menú:",
      error.stack ||
        error.message ||
        error
    );

    return next(error);
  }
}

/* =========================
   CREAR PEDIDO DESDE TIENDA
========================= */

async function createStoreOrder(
  req,
  res,
  next
) {
  try {
    const numero = cleanPhone(
      req.body.numero
    );

    const nombre = String(
      req.body.nombre || ""
    )
      .trim()
      .slice(0, 80);

    const items = Array.isArray(
      req.body.items
    )
      ? req.body.items
      : [];

    if (!numero) {
      return res.status(400).json({
        error:
          "Número inválido",
      });
    }

    if (!items.length) {
      return res.status(400).json({
        error:
          "El carrito está vacío",
      });
    }

    const cliente =
      await Cliente.findOneAndUpdate(
        {
          numero,
        },
        {
          $setOnInsert: {
            numero,
          },

          $set: {
            ultimaActividad:
              new Date(),

            ...(nombre
              ? {
                  nombre,
                }
              : {}),
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

    /* =========================
       BLOQUEAR PEDIDO ACTIVO
    ========================= */

    const activeStates = [
      "confirmado",
      "cocina",
      "en_camino",
    ];

    if (
      activeStates.includes(
        cliente.estadoPedido
      )
    ) {
      return res.status(409).json({
        error:
          "Ya tienes un pedido activo. Debe entregarse o cancelarse antes de iniciar otro.",
      });
    }

    /* =========================
       PRODUCTOS DISPONIBLES
    ========================= */

    const availableProducts =
      await loadAvailableProducts();

    const productById =
      new Map(
        availableProducts.map(
          product => [
            String(product.id),
            product,
          ]
        )
      );

    /* =========================
       LIMPIAR CARRITO ANTERIOR
    ========================= */

    cliente.pedidos = [];
    cliente.estadoPedido =
      "sin_pedido";

    cliente.paso =
      "inicio";

    cliente.productoPendiente =
      null;

    /* =========================
       AGREGAR PRODUCTOS
    ========================= */

    for (const item of items) {
      const product =
        productById.get(
          String(item.id)
        );

      const rawQuantity =
        Number(
          item.cantidad || 1
        );

      const quantity =
        Math.min(
          Math.max(
            Number.isFinite(
              rawQuantity
            )
              ? Math.trunc(
                  rawQuantity
                )
              : 1,
            1
          ),
          20
        );

      if (product) {
        addProduct(
          cliente,
          product,
          quantity
        );
      }
    }

    if (
      !cliente.pedidos.length
    ) {
      return res.status(400).json({
        error:
          "No se encontraron productos válidos en el pedido.",
      });
    }

    cliente.paso =
      "inicio";

    cliente.productoPendiente =
      null;

    cliente.pedidoOrigen =
      "tienda";

    cliente.ultimaActividad =
      new Date();

    await cliente.save();

    /* =========================
       ENVIAR A WHATSAPP
    ========================= */

    try {
      await sendText(
        cliente.numero,
        ticket(
          cliente,
          false
        )
      );

      await sendButtons(
        cliente.numero,
        "Recibimos tu carrito de la tienda en línea. ¿Deseas confirmar tu pedido?",
        [
          {
            id: "confirm_order",
            title: "✅ Confirmar",
          },
          {
            id: "show_cart",
            title: "🛒 Ver carrito",
          },
          {
            id: "empty_cart",
            title: "🗑️ Vaciar",
          },
        ]
      );
    } catch (sendError) {
      console.error(
        "❌ Error enviando pedido de tienda a WhatsApp:",
        sendError.response?.data ||
          sendError.message
      );

      return res.status(502).json({
        error:
          "El pedido se guardó, pero no se pudo enviar a WhatsApp.",

        detalle:
          sendError.response?.data ||
          sendError.message,
      });
    }

    return res.json({
      ok: true,

      numero:
        cliente.numero,

      total:
        totalOf(cliente),

      pedidos:
        cliente.pedidos,

      mensaje:
        "Pedido enviado a WhatsApp. Revisa el chat para confirmar.",
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  showStore,
  getMenu,
  createStoreOrder,
};