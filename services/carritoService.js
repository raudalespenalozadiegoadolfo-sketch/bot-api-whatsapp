function totalOf(cliente) {
  return cliente.pedidos.reduce(
    (sum, item) => sum + item.precio * item.cantidad,
    0
  );
}

function addProduct(cliente, product, quantity = 1) {
  const existing = cliente.pedidos.find(item => item.productId === product.id);

  if (existing) {
    existing.cantidad += quantity;
  } else {
    cliente.pedidos.push({
      productId: product.id,
      nombre: product.name,
      precio: product.price,
      cantidad: quantity,
    });
  }

  cliente.estadoPedido = "armando";
  cliente.ultimaActividad = new Date();
}

function clearDraftOrder(cliente) {
  if (cliente.estadoPedido === "armando") {
    cliente.pedidos = [];
    cliente.productoPendiente = null;
    cliente.paso = "inicio";
    cliente.estadoPedido = "sin_pedido";
    cliente.ultimaActividad = new Date();
    return true;
  }

  return false;
}

function emptyOrder(cliente) {
  cliente.pedidos = [];
  cliente.estadoPedido = "sin_pedido";
  cliente.paso = "inicio";
  cliente.productoPendiente = null;
  cliente.ultimaActividad = new Date();
}

module.exports = {
  totalOf,
  addProduct,
  clearDraftOrder,
  emptyOrder,
};