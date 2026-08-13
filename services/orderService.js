const crypto = require("crypto");
const Order = require("../models/Order");
const { totalOf } = require("./carritoService");

const LEGACY_TO_GENERIC_STATUS = Object.freeze({
  confirmado: "confirmed",
  cocina: "processing",
  en_camino: "in_fulfillment",
  entregado: "completed",
  cancelado: "cancelled",
});

const ACTIVE_STATUSES = Object.freeze(["confirmed", "processing", "ready", "in_fulfillment"]);
const TERMINAL_STATUSES = Object.freeze(["completed", "cancelled"]);

function requireId(value, label) {
  if (!value) throw new Error(`${label} es obligatorio.`);
  return value;
}

function generateOrderNumber(now = new Date()) {
  return `${now.getTime().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function snapshotItems(items) {
  return items.map(item => ({
    productId: /^[a-f\d]{24}$/i.test(String(item.productId || "")) ? item.productId : null,
    name: item.nombre,
    quantity: Number(item.cantidad),
    unitPrice: Number(item.precio),
    lineTotal: Number(item.precio) * Number(item.cantidad),
    variant: item.variant || null,
    options: Array.isArray(item.options) ? item.options : [],
    sku: item.sku || "",
  }));
}

async function createConfirmedOrder(cliente, context = {}) {
  if (!cliente?.tenantId) throw new Error("El cliente no tiene tenantId.");
  const total = totalOf(cliente);
  return Order.create({
    tenantId: cliente.tenantId,
    branchId: context.branchId || cliente.branchId || null,
    customerId: cliente._id,
    orderNumber: generateOrderNumber(),
    channel: cliente.pedidoOrigen === "tienda" ? "storefront" : "whatsapp",
    status: "confirmed",
    legacyStatus: "confirmado",
    items: snapshotItems(cliente.pedidos),
    subtotal: total,
    total,
    currency: context.currency || "MXN",
    fulfillment: {
      type: cliente.direccion ? "delivery" : "pickup",
      address: cliente.direccion || null,
    },
    customerSnapshot: { name: cliente.nombre || "", phone: cliente.numero },
    statusHistory: [{ status: "confirmed", at: new Date() }],
  });
}

async function updateLatestActiveOrder(cliente, legacyStatus, note = "") {
  const status = LEGACY_TO_GENERIC_STATUS[legacyStatus];
  if (!status) return null;
  return Order.findOneAndUpdate(
    {
      tenantId: cliente.tenantId,
      customerId: cliente._id,
      status: { $in: ["confirmed", "processing", "ready", "in_fulfillment"] },
    },
    {
      $set: { status, legacyStatus },
      $push: { statusHistory: { status, at: new Date(), note } },
    },
    { new: true, sort: { createdAt: -1 } }
  );
}

async function getActiveOrders(tenantId) {
  requireId(tenantId, "tenantId");
  return Order.find({ tenantId, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }).lean();
}

async function getOrderHistory(tenantId, limit = 200) {
  requireId(tenantId, "tenantId");
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return Order.find({ tenantId, status: { $in: TERMINAL_STATUSES } })
    .sort({ updatedAt: -1 }).limit(safeLimit).lean();
}

async function findTenantOrderById(tenantId, orderId) {
  requireId(tenantId, "tenantId");
  requireId(orderId, "orderId");
  return Order.findOne({ _id: orderId, tenantId });
}

async function findTenantOrderByNumber(tenantId, orderNumber) {
  requireId(tenantId, "tenantId");
  requireId(orderNumber, "orderNumber");
  return Order.findOne({ tenantId, orderNumber });
}

async function getCustomerOrders(tenantId, customerId) {
  requireId(tenantId, "tenantId");
  requireId(customerId, "customerId");
  return Order.find({ tenantId, customerId }).sort({ createdAt: -1 }).lean();
}

async function updateOrderStatus(tenantId, orderId, legacyStatus, note = "") {
  requireId(tenantId, "tenantId");
  requireId(orderId, "orderId");
  const status = LEGACY_TO_GENERIC_STATUS[legacyStatus];
  if (!status) throw new Error("Estado de pedido inválido.");
  return Order.findOneAndUpdate(
    { _id: orderId, tenantId },
    {
      $set: { status, legacyStatus },
      $push: { statusHistory: { status, at: new Date(), note } },
    },
    { new: true }
  );
}

function cancelOrder(tenantId, orderId, note = "") {
  return updateOrderStatus(tenantId, orderId, "cancelado", note);
}

function completeOrder(tenantId, orderId, note = "") {
  return updateOrderStatus(tenantId, orderId, "entregado", note);
}

async function getDashboardMetrics(tenantId, startOfDay = new Date()) {
  requireId(tenantId, "tenantId");
  const beginning = new Date(startOfDay);
  beginning.setHours(0, 0, 0, 0);
  const orders = await Order.find({ tenantId }).sort({ updatedAt: -1 }).lean();
  const active = orders.filter(order => ACTIVE_STATUSES.includes(order.status));
  const terminal = orders.filter(order => TERMINAL_STATUSES.includes(order.status));
  return {
    activos: active.length,
    confirmados: active.filter(order => order.status === "confirmed").length,
    cocina: active.filter(order => order.status === "processing" || order.status === "ready").length,
    camino: active.filter(order => order.status === "in_fulfillment").length,
    ventasHoy: terminal.filter(order => order.status === "completed" && new Date(order.updatedAt) >= beginning)
      .reduce((sum, order) => sum + Number(order.total || 0), 0),
    historial: terminal.length,
    sourceCount: orders.length,
  };
}

module.exports = {
  LEGACY_TO_GENERIC_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  cancelOrder,
  completeOrder,
  createConfirmedOrder,
  findTenantOrderById,
  findTenantOrderByNumber,
  generateOrderNumber,
  getActiveOrders,
  getCustomerOrders,
  getDashboardMetrics,
  getOrderHistory,
  snapshotItems,
  updateOrderStatus,
  updateLatestActiveOrder,
};
