const { totalOf } = require("./carritoService");

async function syncLegacyCustomerOrder(cliente, legacyStatus, note = "") {
  if (!cliente) return null;
  if (legacyStatus === "entregado" || legacyStatus === "cancelado") {
    if (cliente.pedidos?.length) {
      cliente.historialPedidos.push({
        fecha: new Date(), estadoFinal: legacyStatus,
        pedidos: cliente.pedidos.map(item => ({
          productId: item.productId, nombre: item.nombre,
          precio: item.precio, cantidad: item.cantidad,
        })),
        total: totalOf(cliente), nombre: cliente.nombre, numero: cliente.numero,
        direccion: cliente.direccion, motivoCancelacion: note,
      });
    }
    cliente.pedidos = [];
    cliente.estadoPedido = "sin_pedido";
    cliente.paso = "inicio";
    cliente.productoPendiente = null;
    cliente.horaConfirmacion = null;
  } else {
    cliente.estadoPedido = legacyStatus;
  }
  cliente.ultimaActividad = new Date();
  await cliente.save();
  return cliente;
}

function logLegacyFallback(operation, tenantId) {
  console.warn(JSON.stringify({
    event: "legacy_order_fallback", operation,
    tenantId: String(tenantId), timestamp: new Date().toISOString(),
  }));
}

module.exports = { logLegacyFallback, syncLegacyCustomerOrder };
