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

module.exports = {
  LEGACY_TO_GENERIC_STATUS,
  createConfirmedOrder,
  generateOrderNumber,
  snapshotItems,
  updateLatestActiveOrder,
};
