const { sendText, sendButtons } = require("./whatsappService");
const { ticket } = require("./ticketService");
const { createConfirmedOrder, updateLatestActiveOrder } = require("./orderService");
const { syncLegacyCustomerOrder } = require("./legacyOrderCompatibilityService");

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

async function finalizeOrder(cliente, context = {}) {
  cliente.paso = "inicio";
  cliente.estadoPedido = "confirmado";
  cliente.horaConfirmacion = new Date();
  cliente.ultimaActividad = new Date();
  cliente.productoPendiente = null;

  await cliente.save();
  await createConfirmedOrder(cliente, context);

  return sendText(cliente.numero, ticket(cliente, true));
}

async function saveToHistory(cliente, estadoFinal, motivoCancelacion = "") {
  await updateLatestActiveOrder(cliente, estadoFinal, motivoCancelacion);
  await syncLegacyCustomerOrder(cliente, estadoFinal, motivoCancelacion);
}

module.exports = {
  confirmOrder,
  finalizeOrder,
  saveToHistory,
};
