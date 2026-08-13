const path = require("path");
const Cliente = require("../models/Cliente");
const { totalOf } = require("../services/carritoService");
const orderService = require("../services/orderService");
const { logLegacyFallback, syncLegacyCustomerOrder } = require("../services/legacyOrderCompatibilityService");
const { sendText } = require("../services/whatsappService");

function showPanel(_req, res) {
  return res.sendFile(path.join(__dirname, "..", "public", "panel.html"));
}

function serializeActive(cliente) {
  return {
    id: cliente._id, numero: cliente.numero, nombre: cliente.nombre || "Cliente",
    direccion: cliente.direccion, pedidos: cliente.pedidos, total: totalOf(cliente),
    estadoPedido: cliente.estadoPedido, paso: cliente.paso,
    horaConfirmacion: cliente.horaConfirmacion, ultimaActividad: cliente.ultimaActividad,
    pedidoOrigen: cliente.pedidoOrigen || "whatsapp",
    createdAt: cliente.createdAt, updatedAt: cliente.updatedAt,
  };
}

function legacyStatusOf(order) {
  return order.legacyStatus || ({
    confirmed: "confirmado", processing: "cocina", ready: "cocina",
    in_fulfillment: "en_camino", completed: "entregado", cancelled: "cancelado",
  })[order.status] || order.status;
}

function serializeOrder(order) {
  return {
    id: order._id, orderNumber: order.orderNumber,
    numero: order.customerSnapshot?.phone || "",
    nombre: order.customerSnapshot?.name || "Cliente",
    direccion: order.fulfillment?.address || null,
    pedidos: (order.items || []).map(item => ({
      productId: item.productId, nombre: item.name,
      precio: item.unitPrice, cantidad: item.quantity,
    })),
    total: Number(order.total || 0), estadoPedido: legacyStatusOf(order),
    pedidoOrigen: order.channel === "storefront" ? "tienda" : order.channel,
    horaConfirmacion: order.createdAt, ultimaActividad: order.updatedAt,
    createdAt: order.createdAt, updatedAt: order.updatedAt,
  };
}

function serializeHistoryOrder(order) {
  return {
    ...serializeOrder(order), fecha: order.updatedAt || order.createdAt,
    estadoFinal: legacyStatusOf(order),
    motivoCancelacion: order.status === "cancelled" ? order.statusHistory?.at(-1)?.note || "" : "",
  };
}

async function getActiveOrders(req, res, next) {
  try {
    if (typeof orderService.getActiveOrders === "function") {
      const orders = await orderService.getActiveOrders(req.tenantId);
      if (orders.length) return res.json(orders.map(serializeOrder));
      logLegacyFallback("active_orders", req.tenantId);
    }
    const clientes = await Cliente.find({
      tenantId: req.tenantId, estadoPedido: { $ne: "sin_pedido" },
    }).sort({ ultimaActividad: -1 });
    return res.json(clientes.map(serializeActive));
  } catch (error) { return next(error); }
}

async function getHistory(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
    if (typeof orderService.getOrderHistory === "function") {
      const orders = await orderService.getOrderHistory(req.tenantId, limit);
      if (orders.length) return res.json(orders.map(serializeHistoryOrder));
      logLegacyFallback("order_history", req.tenantId);
    }
    const clientes = await Cliente.find({
      tenantId: req.tenantId, historialPedidos: { $exists: true, $ne: [] },
    }).sort({ updatedAt: -1 });
    const historial = clientes.flatMap(cliente => (cliente.historialPedidos || []).map(pedido => ({
      id: pedido._id, numero: pedido.numero || cliente.numero,
      nombre: pedido.nombre || cliente.nombre || "Cliente", fecha: pedido.fecha,
      estadoFinal: pedido.estadoFinal || "entregado", pedidos: pedido.pedidos || [],
      total: pedido.total || 0, direccion: pedido.direccion || cliente.direccion || null,
      motivoCancelacion: pedido.motivoCancelacion || "",
    }))).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limit);
    return res.json(historial);
  } catch (error) { return next(error); }
}

async function getDashboard(req, res, next) {
  try {
    if (typeof orderService.getDashboardMetrics === "function") {
      const metrics = await orderService.getDashboardMetrics(req.tenantId);
      if (metrics.sourceCount > 0) {
        const { sourceCount: _sourceCount, ...publicMetrics } = metrics;
        return res.json(publicMetrics);
      }
      logLegacyFallback("dashboard", req.tenantId);
    }
    const activos = await Cliente.find({ tenantId: req.tenantId, estadoPedido: { $ne: "sin_pedido" } });
    const clientes = await Cliente.find({
      tenantId: req.tenantId, historialPedidos: { $exists: true, $ne: [] },
    });
    const historial = clientes.flatMap(cliente => cliente.historialPedidos || []);
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    const ventasHoy = historial.filter(pedido => pedido.estadoFinal === "entregado" && new Date(pedido.fecha) >= inicioHoy)
      .reduce((sum, pedido) => sum + Number(pedido.total || 0), 0);
    return res.json({
      activos: activos.length,
      confirmados: activos.filter(c => c.estadoPedido === "confirmado").length,
      cocina: activos.filter(c => c.estadoPedido === "cocina").length,
      camino: activos.filter(c => c.estadoPedido === "en_camino").length,
      ventasHoy, historial: historial.length,
    });
  } catch (error) { return next(error); }
}

async function changeOrderState(req, res, next) {
  try {
    const action = req.params.action;
    const messages = {
      cocina: "🍳 ¡Tu pedido está en cocina!",
      en_camino: "🚚 ¡Tu pedido ya va en camino! Gracias por tu preferencia.",
      entregado: "✅ ¡Pedido entregado! Gracias por tu preferencia.",
      cancelado: "❌ Tu pedido fue cancelado.",
    };
    if (!messages[action]) return res.status(400).json({ error: "Acción inválida" });

    const orderId = String(req.body.orderId || req.body.id || "").trim();
    const numero = String(req.body.numero || "").trim();
    if (!orderId && !numero) return res.status(400).json({ error: "Debes indicar el pedido o el número del cliente." });

    let cliente = numero ? await Cliente.findOne({ tenantId: req.tenantId, numero }) : null;
    let order = null;
    const canonicalAvailable = typeof orderService.findTenantOrderById === "function";
    if (canonicalAvailable) {
      if (orderId) order = await orderService.findTenantOrderById(req.tenantId, orderId);
      if (!order && cliente && typeof orderService.getCustomerOrders === "function") {
        const customerOrders = await orderService.getCustomerOrders(req.tenantId, cliente._id);
        order = customerOrders.find(item => ["confirmed", "processing", "ready", "in_fulfillment"].includes(item.status));
      }
      if (!order && orderId) return res.status(404).json({ error: "Pedido no encontrado" });
      if (!cliente && order?.customerId) cliente = await Cliente.findOne({ tenantId: req.tenantId, _id: order.customerId });
    }
    if (!cliente && !order) return res.status(404).json({ error: "Cliente no encontrado" });

    const note = String(req.body.motivo || "").trim().slice(0, 300);
    if (order) {
      if (action === "entregado") order = await orderService.completeOrder(req.tenantId, order._id, note);
      else if (action === "cancelado") order = await orderService.cancelOrder(req.tenantId, order._id, note);
      else order = await orderService.updateOrderStatus(req.tenantId, order._id, action, note);
      if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
      if (cliente) await syncLegacyCustomerOrder(cliente, action, note);
    } else {
      logLegacyFallback("change_order_state", req.tenantId);
      await syncLegacyCustomerOrder(cliente, action, note);
      if (typeof orderService.updateLatestActiveOrder === "function") {
        await orderService.updateLatestActiveOrder(cliente, action, note);
      }
    }

    try {
      const destination = cliente?.numero || order?.customerSnapshot?.phone;
      if (destination) await sendText(destination, messages[action]);
    } catch (error) {
      console.error("No se pudo enviar WhatsApp:", error.response?.data || error.message);
    }
    return res.json({
      ok: true, action,
      cliente: order ? serializeOrder(order) : serializeActive(cliente),
    });
  } catch (error) { return next(error); }
}

module.exports = {
  changeOrderState, getActiveOrders, getDashboard, getHistory,
  serializeHistoryOrder, serializeOrder, showPanel,
};
