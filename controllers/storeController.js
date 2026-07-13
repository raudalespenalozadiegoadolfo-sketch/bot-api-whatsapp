const path = require("path");

const Cliente = require("../models/Cliente");

const {
  products,
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
   OBTENER MENÚ
========================= */

function getMenu(_req, res) {
  const categories = [
    ...new Set(
      products.map(product => product.category)
    ),
  ];

  return res.json({
    categories,
    products,
  });
}

/* =========================
   CREAR PEDIDO DESDE TIENDA
========================= */

async function createStoreOrder(req, res, next) {
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
        error: "Número inválido",
      });
    }

    if (!items.length) {
      return res.status(400).json({
        error: "El carrito está vacío",
      });
    }

    const cliente =
      await Cliente.findOneAndUpdate(
        { numero },
        {
          $setOnInsert: {
            numero,
          },
          $set: {
            ultimaActividad: new Date(),
            ...(nombre
              ? { nombre }
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
       PEDIDO ACTIVO
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
       LIMPIAR CARRITO ANTERIOR
    ========================= */

    cliente.pedidos = [];
    cliente.estadoPedido = "sin_pedido";
    cliente.paso = "inicio";
    cliente.productoPendiente = null;

    /* =========================
       AGREGAR PRODUCTOS
    ========================= */

    for (const item of items) {
      const product = products.find(
        currentProduct =>
          currentProduct.id === item.id
      );

      const quantity = Math.min(
        Math.max(
          Number(item.cantidad || 1),
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

    if (!cliente.pedidos.length) {
      return res.status(400).json({
        error:
          "No se encontraron productos válidos en el pedido.",
      });
    }

    cliente.paso = "inicio";
    cliente.productoPendiente = null;
    cliente.pedidoOrigen = "tienda";
    cliente.ultimaActividad = new Date();

    await cliente.save();

    /* =========================
       ENVIAR A WHATSAPP
    ========================= */

    try {
      await sendText(
        cliente.numero,
        ticket(cliente, false)
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
        "Error enviando pedido de tienda a WhatsApp:",
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
      numero: cliente.numero,
      total: totalOf(cliente),
      pedidos: cliente.pedidos,
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