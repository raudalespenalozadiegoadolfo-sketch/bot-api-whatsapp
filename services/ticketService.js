const { totalOf } = require("./carritoService");

function ticket(cliente, confirmed = false) {
  const title = confirmed ? "✅ *PEDIDO RECIBIDO*" : "🧾 *TU PEDIDO*";

  const lines = cliente.pedidos.map(item =>
    `• ${item.cantidad}x ${item.nombre} — $${item.precio * item.cantidad}`
  );

  return `${title}
──────────────
${lines.join("\n")}
──────────────
💰 *TOTAL: $${totalOf(cliente)}*
${confirmed ? "\nTu pedido fue recibido. Te avisaremos cuando esté en cocina y cuando vaya en camino." : ""}`;
}

module.exports = {
  ticket,
};