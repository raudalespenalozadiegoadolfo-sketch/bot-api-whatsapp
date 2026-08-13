const Cliente = require("../models/Cliente");

async function findOrCreateCliente(numero, context) {
  if (!context?.tenantId) throw new Error("Se requiere tenantId para buscar al cliente.");
  const cliente = await Cliente.findOneAndUpdate(
    { tenantId: context.tenantId, numero },
    {
      $setOnInsert: { tenantId: context.tenantId, numero },
      $set: {
        ultimaActividad: new Date(),
        ...(context.branchId ? { branchId: context.branchId } : {}),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return cliente;
}

async function saveCliente(cliente) {
  cliente.ultimaActividad = new Date();
  await cliente.save();
  return cliente;
}

function resetDraft(cliente) {
  cliente.pedidos = [];
  cliente.productoPendiente = null;
  cliente.paso = "inicio";
  cliente.estadoPedido = "sin_pedido";
  cliente.ultimaActividad = new Date();
}

function hasActiveConfirmedOrder(cliente) {
  return ["confirmado", "cocina", "en_camino"].includes(cliente.estadoPedido);
}

module.exports = {
  findOrCreateCliente,
  saveCliente,
  resetDraft,
  hasActiveConfirmedOrder,
};
