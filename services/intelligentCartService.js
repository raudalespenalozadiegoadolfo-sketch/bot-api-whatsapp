const {
  normalize,
} = require("./utilsService");

const {
  addProduct,
  emptyOrder,
  totalOf,
} = require("./carritoService");

const {
  ticket,
} = require("./ticketService");

/* =========================
   BUSCAR PRODUCTO
========================= */

function findCartItem(cliente, product) {
  if (!cliente?.pedidos?.length || !product) {
    return null;
  }

  return cliente.pedidos.find(item =>
    item.productId === product.id ||
    normalize(item.nombre) === normalize(product.name)
  );
}

/* =========================
   ACTUALIZAR ESTADO
========================= */

function updateCartState(cliente) {
  cliente.estadoPedido = cliente.pedidos.length
    ? "armando"
    : "sin_pedido";

  cliente.productoPendiente = null;
  cliente.paso = "inicio";
  cliente.ultimaActividad = new Date();
}

/* =========================
   VACIAR CARRITO
========================= */

function executeEmptyCart(cliente) {
  emptyOrder(cliente);
  updateCartState(cliente);

  return {
    ok: true,
    action: "empty_cart",
    message: "🗑️ Tu carrito quedó vacío.",
    cartEmpty: true,
  };
}

/* =========================
   DEJAR SOLO UN PRODUCTO
========================= */

function executeKeepOnly(cliente, command) {
  const item = findCartItem(
    cliente,
    command.product
  );

  if (!item) {
    return {
      ok: false,
      message: `${command.product.name} no está en tu carrito.`,
    };
  }

  cliente.pedidos = [
    {
      productId: item.productId,
      nombre: item.nombre,
      precio: item.precio,
      cantidad:
        command.quantity || item.cantidad,
    },
  ];

  updateCartState(cliente);

  return {
    ok: true,
    action: "keep_only",
    message:
      `✅ Dejé únicamente ${cliente.pedidos[0].cantidad}x ${item.nombre}.`,
  };
}

/* =========================
   CAMBIAR CANTIDAD
========================= */

function executeReplaceQuantity(
  cliente,
  command
) {
  const item = findCartItem(
    cliente,
    command.product
  );

  if (!item) {
    return {
      ok: false,
      message: `${command.product.name} no está en tu carrito.`,
    };
  }

  const quantity = Math.min(
    Math.max(
      Number(command.quantity || 1),
      1
    ),
    20
  );

  item.cantidad = quantity;

  updateCartState(cliente);

  return {
    ok: true,
    action: "replace_quantity",
    message:
      `✅ Cambié ${item.nombre} a ${quantity}.`,
  };
}

/* =========================
   ELIMINAR PRODUCTO
========================= */

function executeRemoveProduct(
  cliente,
  command
) {
  const item = findCartItem(
    cliente,
    command.product
  );

  if (!item) {
    return {
      ok: false,
      message: `${command.product.name} no está en tu carrito.`,
    };
  }

  const quantity = command.quantity
    ? Number(command.quantity)
    : null;

  if (
    quantity &&
    quantity > 0 &&
    quantity < item.cantidad
  ) {
    item.cantidad -= quantity;

    updateCartState(cliente);

    return {
      ok: true,
      action: "remove_product",
      message:
        `✅ Quité ${quantity}x ${item.nombre}.`,
    };
  }

  cliente.pedidos = cliente.pedidos.filter(
    current =>
      current.productId !== item.productId
  );

  updateCartState(cliente);

  return {
    ok: true,
    action: "remove_product",
    message:
      cliente.pedidos.length
        ? `✅ Eliminé ${item.nombre} del carrito.`
        : `✅ Eliminé ${item.nombre}. Tu carrito quedó vacío.`,
    cartEmpty:
      cliente.pedidos.length === 0,
  };
}

/* =========================
   REEMPLAZAR PRODUCTO
========================= */

function executeReplaceProduct(
  cliente,
  command
) {
  const sourceItem = findCartItem(
    cliente,
    command.sourceProduct
  );

  if (!sourceItem) {
    return {
      ok: false,
      message:
        `${command.sourceProduct.name} no está en tu carrito.`,
    };
  }

  const quantity =
    command.quantity ||
    sourceItem.cantidad;

  cliente.pedidos = cliente.pedidos.filter(
    item =>
      item.productId !== sourceItem.productId
  );

  addProduct(
    cliente,
    command.targetProduct,
    quantity
  );

  updateCartState(cliente);

  return {
    ok: true,
    action: "replace_product",
    message:
      `✅ Cambié ${command.sourceProduct.name} por ${quantity}x ${command.targetProduct.name}.`,
  };
}

/* =========================
   AGREGAR PRODUCTOS
========================= */

function executeAddProducts(
  cliente,
  command
) {
  if (!command.products?.length) {
    return {
      ok: false,
      message:
        "No pude identificar qué producto deseas agregar.",
    };
  }

  command.products.forEach(
    ({ product, quantity }) => {
      addProduct(
        cliente,
        product,
        quantity || 1
      );
    }
  );

  updateCartState(cliente);

  const resumen = command.products
    .map(
      ({ product, quantity }) =>
        `• ${quantity || 1}x ${product.name}`
    )
    .join("\n");

  return {
    ok: true,
    action: "add_product",
    message:
      `✅ Agregué a tu carrito:\n${resumen}`,
  };
}

/* =========================
   EJECUTAR COMANDO
========================= */

function executeCartCommand(
  cliente,
  command
) {
  if (!command?.handled) {
    return {
      handled: false,
    };
  }

  let result;

  switch (command.action) {
    case "empty_cart":
      result = executeEmptyCart(cliente);
      break;

    case "keep_only":
      result = executeKeepOnly(
        cliente,
        command
      );
      break;

    case "replace_quantity":
      result = executeReplaceQuantity(
        cliente,
        command
      );
      break;

    case "remove_product":
      result = executeRemoveProduct(
        cliente,
        command
      );
      break;

    case "replace_product":
      result = executeReplaceProduct(
        cliente,
        command
      );
      break;

    case "add_product":
      result = executeAddProducts(
        cliente,
        command
      );
      break;

    default:
      return {
        handled: false,
      };
  }

  return {
    handled: true,
    ...result,
    total: totalOf(cliente),
    ticket:
      cliente.pedidos.length
        ? ticket(cliente)
        : "",
  };
}

module.exports = {
  findCartItem,
  executeCartCommand,
  executeEmptyCart,
  executeKeepOnly,
  executeReplaceQuantity,
  executeRemoveProduct,
  executeReplaceProduct,
  executeAddProducts,
};