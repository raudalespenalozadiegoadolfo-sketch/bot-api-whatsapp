const path = require("path");

const Cliente = require("../models/Cliente");

const {
  totalOf,
} = require("../services/carritoService");

const {
  saveToHistory,
} = require("../services/orderFlowService");

const {
  sendText,
} = require("../services/whatsappService");

/* =========================
   MOSTRAR PANEL
========================= */

function showPanel(_req, res) {
  return res.sendFile(
    path.join(
      __dirname,
      "..",
      "public",
      "panel.html"
    )
  );
}

/* =========================
   SERIALIZAR PEDIDO ACTIVO
========================= */

function serializeActive(cliente) {
  return {
    id: cliente._id,
    numero: cliente.numero,
    nombre: cliente.nombre || "Cliente",
    direccion: cliente.direccion,
    pedidos: cliente.pedidos,
    total: totalOf(cliente),
    estadoPedido: cliente.estadoPedido,
    paso: cliente.paso,
    horaConfirmacion: cliente.horaConfirmacion,
    ultimaActividad: cliente.ultimaActividad,
    pedidoOrigen:
      cliente.pedidoOrigen || "whatsapp",
    createdAt: cliente.createdAt,
    updatedAt: cliente.updatedAt,
  };
}

/* =========================
   PEDIDOS ACTIVOS
========================= */

async function getActiveOrders(_req, res, next) {
  try {
    const clientes = await Cliente.find({
      estadoPedido: {
        $ne: "sin_pedido",
      },
    }).sort({
      ultimaActividad: -1,
    });

    return res.json(
      clientes.map(serializeActive)
    );
  } catch (error) {
    return next(error);
  }
}

/* =========================
   HISTORIAL
========================= */

async function getHistory(req, res, next) {
  try {
    const limit = Math.min(
      Math.max(
        Number(req.query.limit || 200),
        1
      ),
      1000
    );

    const clientes = await Cliente.find({
      historialPedidos: {
        $exists: true,
        $ne: [],
      },
    }).sort({
      updatedAt: -1,
    });

    const historial = clientes
      .flatMap(cliente =>
        (cliente.historialPedidos || []).map(
          pedido => ({
            id: pedido._id,
            numero:
              pedido.numero ||
              cliente.numero,
            nombre:
              pedido.nombre ||
              cliente.nombre ||
              "Cliente",
            fecha: pedido.fecha,
            estadoFinal:
              pedido.estadoFinal ||
              "entregado",
            pedidos:
              pedido.pedidos || [],
            total:
              pedido.total || 0,
            direccion:
              pedido.direccion ||
              cliente.direccion ||
              null,
            motivoCancelacion:
              pedido.motivoCancelacion ||
              "",
          })
        )
      )
      .sort(
        (first, second) =>
          new Date(second.fecha) -
          new Date(first.fecha)
      )
      .slice(0, limit);

    return res.json(historial);
  } catch (error) {
    return next(error);
  }
}

/* =========================
   DASHBOARD
========================= */

async function getDashboard(_req, res, next) {
  try {
    const activos = await Cliente.find({
      estadoPedido: {
        $ne: "sin_pedido",
      },
    });

    const clientesConHistorial =
      await Cliente.find({
        historialPedidos: {
          $exists: true,
          $ne: [],
        },
      });

    const historial =
      clientesConHistorial.flatMap(
        cliente =>
          cliente.historialPedidos || []
      );

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const ventasHoy = historial
      .filter(
        pedido =>
          pedido.estadoFinal ===
            "entregado" &&
          new Date(pedido.fecha) >=
            inicioHoy
      )
      .reduce(
        (total, pedido) =>
          total +
          Number(pedido.total || 0),
        0
      );

    return res.json({
      activos: activos.length,

      confirmados: activos.filter(
        cliente =>
          cliente.estadoPedido ===
          "confirmado"
      ).length,

      cocina: activos.filter(
        cliente =>
          cliente.estadoPedido ===
          "cocina"
      ).length,

      camino: activos.filter(
        cliente =>
          cliente.estadoPedido ===
          "en_camino"
      ).length,

      ventasHoy,
      historial: historial.length,
    });
  } catch (error) {
    return next(error);
  }
}

/* =========================
   CAMBIAR ESTADO
========================= */

async function changeOrderState(
  req,
  res,
  next
) {
  try {
    const action = req.params.action;

    const messages = {
      cocina:
        "🍳 ¡Tu pedido está en cocina!",

      en_camino:
        "🚚 ¡Tu pedido ya va en camino! Gracias por tu preferencia.",

      entregado:
        "✅ ¡Pedido entregado! Gracias por tu preferencia.",

      cancelado:
        "❌ Tu pedido fue cancelado.",
    };

    if (!messages[action]) {
      return res.status(400).json({
        error: "Acción inválida",
      });
    }

    const numero = String(
      req.body.numero || ""
    ).trim();

    if (!numero) {
      return res.status(400).json({
        error:
          "Debes indicar el número del cliente.",
      });
    }

    const cliente = await Cliente.findOne({
      numero,
    });

    if (!cliente) {
      return res.status(404).json({
        error: "Cliente no encontrado",
      });
    }

    if (
      action === "entregado" ||
      action === "cancelado"
    ) {
      await saveToHistory(
        cliente,
        action,
        String(req.body.motivo || "")
          .trim()
          .slice(0, 300)
      );
    } else {
      cliente.estadoPedido = action;
      cliente.ultimaActividad =
        new Date();

      await cliente.save();
    }

    try {
      await sendText(
        cliente.numero,
        messages[action]
      );
    } catch (sendError) {
      console.error(
        "No se pudo enviar WhatsApp:",
        sendError.response?.data ||
          sendError.message
      );
    }

    return res.json({
      ok: true,
      action,
      cliente:
        action === "entregado" ||
        action === "cancelado"
          ? {
              numero: cliente.numero,
              estadoPedido:
                cliente.estadoPedido,
            }
          : serializeActive(cliente),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  showPanel,
  getActiveOrders,
  getHistory,
  getDashboard,
  changeOrderState,
};