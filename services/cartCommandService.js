const {
  detectProducts,
} = require("./productMatcherService");

const {
  normalize,
  wordsToNumbers,
} = require("./utilsService");

/* =========================
   DETECTAR INTENCIÓN
========================= */

function detectCartIntent(text = "") {
  const normalized = normalize(
    wordsToNumbers(text)
  );

  if (
    /\b(quita|quitar|elimina|eliminar|borra|borrar|remueve|remover)\b/.test(
      normalized
    )
  ) {
    return "remove";
  }

  if (
    /\b(cambia|cambiar|reemplaza|reemplazar|sustituye|sustituir)\b/.test(
      normalized
    )
  ) {
    return "replace";
  }

  if (
    /\b(deja|dejame|solo|únicamente|unicamente)\b/.test(
      normalized
    )
  ) {
    return "keep_only";
  }

  if (
    /\b(agrega|agregar|añade|anade|sumale|súmale|otra|otro)\b/.test(
      normalized
    )
  ) {
    return "add";
  }

  return null;
}

/* =========================
   CANTIDAD SOLICITADA
========================= */

function extractQuantity(text = "") {
  const normalized = wordsToNumbers(text);
  const match = normalized.match(/\b(\d{1,2})\b/);

  if (!match) {
    return 1;
  }

  return Math.min(
    Math.max(Number(match[1]), 1),
    20
  );
}

/* =========================
   BUSCAR PRODUCTO EN CARRITO
========================= */

function findCartItem(cliente, product) {
  if (!cliente?.pedidos?.length) {
    return null;
  }

  return cliente.pedidos.find(
    item =>
      item.productId === product.id ||
      normalize(item.nombre) ===
        normalize(product.name)
  );
}

/* =========================
   QUITAR PRODUCTO
========================= */

function removeProduct(
  cliente,
  product,
  quantity = null
) {
  const item = findCartItem(
    cliente,
    product
  );

  if (!item) {
    return {
      ok: false,
      message:
        `${product.name} no está en tu carrito.`,
    };
  }

  if (
    quantity &&
    quantity < item.cantidad
  ) {
    item.cantidad -= quantity;

    return {
      ok: true,
      message:
        `Quité ${quantity}x ${product.name}.`,
    };
  }

  cliente.pedidos = cliente.pedidos.filter(
    current =>
      current.productId !== product.id
  );

  return {
    ok: true,
    message:
      `Eliminé ${product.name} del carrito.`,
  };
}

/* =========================
   DEJAR SOLO UN PRODUCTO
========================= */

function keepOnlyProduct(
  cliente,
  product,
  quantity
) {
  const item = findCartItem(
    cliente,
    product
  );

  if (!item) {
    return {
      ok: false,
      message:
        `${product.name} no está en tu carrito.`,
    };
  }

  cliente.pedidos = [
    {
      productId: item.productId,
      nombre: item.nombre,
      precio: item.precio,
      cantidad:
        quantity || item.cantidad,
    },
  ];

  return {
    ok: true,
    message:
      `Dejé únicamente ${cliente.pedidos[0].cantidad}x ${product.name}.`,
  };
}

/* =========================
   CAMBIAR CANTIDAD
========================= */

function changeQuantity(
  cliente,
  product,
  quantity
) {
  const item = findCartItem(
    cliente,
    product
  );

  if (!item) {
    return {
      ok: false,
      message:
        `${product.name} no está en tu carrito.`,
    };
  }

  item.cantidad = quantity;

  return {
    ok: true,
    message:
      `Ahora tienes ${quantity}x ${product.name}.`,
  };
}

/* =========================
   PROCESAR COMANDO
========================= */

function processCartCommand(
  cliente,
  text = ""
) {
  const intent = detectCartIntent(text);

  if (!intent) {
    return {
      handled: false,
    };
  }

  const detected = detectProducts(text);

  if (!detected.length) {
    return {
      handled: true,
      ok: false,
      message:
        "No pude identificar qué producto deseas modificar.",
    };
  }

  const {
    product,
    quantity: detectedQuantity,
  } = detected[0];

  const quantity =
    extractQuantity(text) ||
    detectedQuantity ||
    1;

  let result;

  if (intent === "remove") {
    result = removeProduct(
      cliente,
      product,
      quantity
    );
  }

  if (intent === "replace") {
    result = changeQuantity(
      cliente,
      product,
      quantity
    );
  }

  if (intent === "keep_only") {
    result = keepOnlyProduct(
      cliente,
      product,
      quantity
    );
  }

  if (intent === "add") {
    return {
      handled: false,
    };
  }

  if (!result) {
    return {
      handled: false,
    };
  }

  if (!cliente.pedidos.length) {
    cliente.estadoPedido =
      "sin_pedido";
  } else {
    cliente.estadoPedido =
      "armando";
  }

  cliente.ultimaActividad =
    new Date();

  return {
    handled: true,
    ...result,
  };
}

module.exports = {
  detectCartIntent,
  extractQuantity,
  findCartItem,
  removeProduct,
  keepOnlyProduct,
  changeQuantity,
  processCartCommand,
};