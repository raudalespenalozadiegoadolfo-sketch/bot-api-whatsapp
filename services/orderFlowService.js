const { sendText, sendButtons } = require("./whatsappService");
const { ticket } = require("./ticketService");
const { totalOf } = require("./carritoService");

async function confirmOrder(cliente) {
  if (!cliente.pedidos.length) {
    return sendText(cliente.numero, "Tu carrito está vacío.");
  }

  if (!cliente.nombre) {
    cliente.paso = "esperando_nombre";
    await cliente.save();
    return sendText(cliente.numero, "¿A nombre de quién será el pedido?");
  }

  if (!cliente.direccion) {
    cliente.paso = "esperando_ubicacion";
    await cliente.save();
    return sendText(
      cliente.numero,
      "Compárteme tu ubicación usando el clip de WhatsApp."
    );
  }

  cliente.paso = "confirmando_direccion";
  await cliente.save();

  return sendButtons(cliente.numero, "¿Usamos tu ubicación anterior?", [
    { id: "address_yes", title: "Sí" },
    { id: "address_no", title: "No" },
  ]);
}

async function finalizeOrder(cliente) {
  cliente.paso = "inicio";
  cliente.estadoPedido = "confirmado";
  cliente.horaConfirmacion = new Date();
  cliente.ultimaActividad = new Date();
  cliente.productoPendiente = null;

  await cliente.save();

  return sendText(cliente.numero, ticket(cliente, true));
}

async function saveToHistory(cliente, estadoFinal, motivoCancelacion = "") {
  if (cliente.pedidos.length) {
    cliente.historialPedidos.push({
      fecha: new Date(),
      estadoFinal,
      pedidos: cliente.pedidos.map(item => ({
        productId: item.productId,
        nombre: item.nombre,
        precio: item.precio,
        cantidad: item.cantidad,
      })),
      total: totalOf(cliente),
      nombre: cliente.nombre,
      numero: cliente.numero,
      direccion: cliente.direccion,
      motivoCancelacion,
    });
  }

  cliente.pedidos = [];
  cliente.estadoPedido = "sin_pedido";
  cliente.paso = "inicio";
  cliente.productoPendiente = null;
  cliente.horaConfirmacion = null;
  cliente.ultimaActividad = new Date();

  await cliente.save();
}

module.exports = {
  confirmOrder,
  finalizeOrder,
  saveToHistory,
};