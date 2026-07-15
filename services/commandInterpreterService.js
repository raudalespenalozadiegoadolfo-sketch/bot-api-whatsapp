const {
  detectProducts,
} = require("./productMatcherService");

const {
  normalize,
  wordsToNumbers,
} = require("./utilsService");

/* =========================
   CONSTANTES
========================= */

const MAX_QUANTITY = 20;

const ACTION_PATTERNS = {
  empty_cart: [
    /\b(vacia|vaciar|borra|borrar|elimina|eliminar)\s+(todo|carrito|pedido)\b/,
    /\bya no quiero nada\b/,
    /\bquita todo\b/,
  ],

  keep_only: [
    /\bsolo\s+(deja|dejame|quiero|conserva)\b/,
    /\b(deja|dejame|conserva)\s+solo\b/,
    /\búnicamente\b/,
    /\bunicamente\b/,
  ],

  replace_quantity: [
    /\b(cambia|cambiar|modifica|modificar|pon|poner|deja|dejame)\b/,
    /\b(mejor)\b/,
    /\b(ahora quiero)\b/,
  ],

  remove_product: [
    /\b(quita|quitar|elimina|eliminar|borra|borrar|remueve|remover|saca|sacar)\b/,
    /\bya no quiero\b/,
    /\bsin\b/,
  ],

  add_product: [
    /\b(agrega|agregar|añade|anade|suma|sumale|súmale|ponle)\b/,
    /\b(quiero|dame|me das|mandame|mándame)\b/,
    /\b(otra|otro|mas|más)\b/,
  ],
};

/* =========================
   PREPARAR TEXTO
========================= */

function prepareCommandText(value = "") {
  return normalize(
    wordsToNumbers(value)
  )
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   DETECTAR CANTIDAD
========================= */

function clampQuantity(value) {
  const quantity = Number(value);

  if (!Number.isFinite(quantity)) {
    return null;
  }

  return Math.min(
    Math.max(
      Math.trunc(quantity),
      1
    ),
    MAX_QUANTITY
  );
}

function extractAllNumbers(text = "") {
  const normalized =
    prepareCommandText(text);

  return [
    ...normalized.matchAll(/\b(\d{1,2})\b/g),
  ].map(match => ({
    value: clampQuantity(match[1]),
    index: match.index,
  }));
}

function extractQuantity(text = "") {
  const numbers = extractAllNumbers(text);

  if (!numbers.length) {
    return null;
  }

  return numbers[numbers.length - 1].value;
}

function extractQuantityAfterProduct(
  text,
  productDetection
) {
  const normalized =
    prepareCommandText(text);

  const start =
    productDetection.index +
    productDetection.keyLength;

  const afterProduct =
    normalized.slice(start);

  const match = afterProduct.match(
    /\b(?:por|a|en|deja(?:lo|la|los|las)?\s+en)?\s*(\d{1,2})\b/
  );

  if (!match) {
    return null;
  }

  return clampQuantity(match[1]);
}

function extractQuantityBeforeProduct(
  text,
  productDetection
) {
  const normalized =
    prepareCommandText(text);

  const beforeProduct =
    normalized.slice(
      Math.max(
        0,
        productDetection.index - 40
      ),
      productDetection.index
    );

  const match = beforeProduct.match(
    /(\d{1,2})\s*(?:x|piezas?|ordenes?)?\s*$/
  );

  if (!match) {
    return null;
  }

  return clampQuantity(match[1]);
}

function getQuantityForProduct(
  text,
  detection,
  fallback = 1
) {
  return (
    extractQuantityAfterProduct(
      text,
      detection
    ) ||
    extractQuantityBeforeProduct(
      text,
      detection
    ) ||
    clampQuantity(
      detection.quantity
    ) ||
    extractQuantity(text) ||
    fallback
  );
}

/* =========================
   DETECTAR ACCIÓN
========================= */

function matchesAnyPattern(
  text,
  patterns
) {
  return patterns.some(pattern =>
    pattern.test(text)
  );
}

function detectAction(text = "") {
  const normalized =
    prepareCommandText(text);

  if (
    matchesAnyPattern(
      normalized,
      ACTION_PATTERNS.empty_cart
    )
  ) {
    return "empty_cart";
  }

  if (
    matchesAnyPattern(
      normalized,
      ACTION_PATTERNS.keep_only
    )
  ) {
    return "keep_only";
  }

  /*
   * "Cambia las arracheras por 3"
   * debe detectarse antes de "remove_product".
   */
  if (
    matchesAnyPattern(
      normalized,
      ACTION_PATTERNS.replace_quantity
    ) &&
    /\b\d{1,2}\b/.test(normalized)
  ) {
    return "replace_quantity";
  }

  if (
    matchesAnyPattern(
      normalized,
      ACTION_PATTERNS.remove_product
    )
  ) {
    return "remove_product";
  }

  if (
    matchesAnyPattern(
      normalized,
      ACTION_PATTERNS.add_product
    )
  ) {
    return "add_product";
  }

  return "unknown";
}

/* =========================
   DETECTAR REEMPLAZO
========================= */

function detectProductReplacement(
  text,
  productsDetected
) {
  const normalized =
    prepareCommandText(text);

  const hasReplacementConnector =
    /\b(por|en lugar de|cambialo por|cambiala por|reemplaza por)\b/.test(
      normalized
    );

  if (
    !hasReplacementConnector ||
    productsDetected.length < 2
  ) {
    return null;
  }

  return {
    action: "replace_product",
    sourceProduct:
      productsDetected[0].product,
    targetProduct:
      productsDetected[1].product,
    quantity:
      getQuantityForProduct(
        text,
        productsDetected[1],
        1
      ),
  };
}

/* =========================
   INTERPRETAR COMANDO
========================= */

function interpretCommand(text = "") {
  const normalized =
    prepareCommandText(text);

  if (!normalized) {
    return {
      handled: false,
      action: "unknown",
      confidence: 0,
      originalText: text,
    };
  }

  const action =
    detectAction(normalized);

  if (action === "empty_cart") {
    return {
      handled: true,
      action: "empty_cart",
      confidence: 1,
      originalText: text,
      normalizedText: normalized,
      products: [],
    };
  }

  const productsDetected =
    detectProducts(text);

  const replacement =
    detectProductReplacement(
      text,
      productsDetected
    );

  if (replacement) {
    return {
      handled: true,
      confidence: 0.95,
      originalText: text,
      normalizedText: normalized,
      products: productsDetected,
      ...replacement,
    };
  }

  if (!productsDetected.length) {
    const quantity =
      extractQuantity(text);

    /*
     * Ejemplo:
     * "mejor 3"
     * Puede aplicarse al último producto usado
     * si el controlador guarda ese contexto.
     */
    if (
      action === "replace_quantity" &&
      quantity
    ) {
      return {
        handled: true,
        action: "replace_last_quantity",
        quantity,
        confidence: 0.7,
        requiresContext: true,
        originalText: text,
        normalizedText: normalized,
        products: [],
      };
    }

    return {
      handled:
        action !== "unknown",
      action,
      confidence: 0.3,
      originalText: text,
      normalizedText: normalized,
      products: [],
      error:
        "No pude identificar el producto.",
    };
  }

  const interpretedProducts =
    productsDetected.map(detection => ({
      product: detection.product,
      quantity:
        getQuantityForProduct(
          text,
          detection,
          1
        ),
      similarity:
        detection.similarity ?? 1,
      matchedText:
        detection.matchedText || "",
      index:
        detection.index,
    }));

  const firstProduct =
    interpretedProducts[0];

  if (action === "keep_only") {
    return {
      handled: true,
      action: "keep_only",
      product: firstProduct.product,
      quantity:
        firstProduct.quantity,
      confidence:
        firstProduct.similarity,
      originalText: text,
      normalizedText: normalized,
      products: interpretedProducts,
    };
  }

  if (
    action === "replace_quantity"
  ) {
    return {
      handled: true,
      action: "replace_quantity",
      product: firstProduct.product,
      quantity:
        firstProduct.quantity,
      confidence:
        firstProduct.similarity,
      originalText: text,
      normalizedText: normalized,
      products: interpretedProducts,
    };
  }

  if (
    action === "remove_product"
  ) {
    const explicitQuantity =
      extractQuantityBeforeProduct(
        text,
        productsDetected[0]
      ) ||
      extractQuantityAfterProduct(
        text,
        productsDetected[0]
      );

    return {
      handled: true,
      action: "remove_product",
      product: firstProduct.product,

      /*
       * null significa eliminar
       * completamente el producto.
       * Ejemplo: "quita las cocas".
       *
       * 1 significa reducir una unidad.
       * Ejemplo: "quita 1 coca".
       */
      quantity:
        explicitQuantity || null,

      confidence:
        firstProduct.similarity,
      originalText: text,
      normalizedText: normalized,
      products: interpretedProducts,
    };
  }

  if (
    action === "add_product" ||
    action === "unknown"
  ) {
    return {
      handled: true,
      action: "add_product",
      confidence: Math.min(
        ...interpretedProducts.map(
          item => item.similarity
        )
      ),
      originalText: text,
      normalizedText: normalized,
      products: interpretedProducts,
    };
  }

  return {
    handled: false,
    action: "unknown",
    confidence: 0,
    originalText: text,
    normalizedText: normalized,
    products: interpretedProducts,
  };
}

/* =========================
   DESCRIBIR COMANDO
========================= */

function describeCommand(command) {
  if (!command?.handled) {
    return "No se identificó una acción.";
  }

  const productName =
    command.product?.name ||
    command.sourceProduct?.name ||
    "";

  switch (command.action) {
    case "empty_cart":
      return "Vaciar carrito";

    case "keep_only":
      return `Dejar solo ${productName}`;

    case "replace_quantity":
      return `Cambiar ${productName} a ${command.quantity}`;

    case "replace_last_quantity":
      return `Cambiar último producto a ${command.quantity}`;

    case "remove_product":
      return command.quantity
        ? `Quitar ${command.quantity} de ${productName}`
        : `Eliminar ${productName}`;

    case "replace_product":
      return `Cambiar ${command.sourceProduct.name} por ${command.targetProduct.name}`;

    case "add_product":
      return `Agregar ${command.products
        .map(
          item =>
            `${item.quantity}x ${item.product.name}`
        )
        .join(", ")}`;

    default:
      return command.action;
  }
}

module.exports = {
  interpretCommand,
  describeCommand,
  detectAction,
  extractQuantity,
  extractAllNumbers,
  getQuantityForProduct,
  prepareCommandText,
};