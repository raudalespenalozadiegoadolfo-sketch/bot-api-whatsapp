const { products } = require("./menuService");
const {
  normalize,
  wordsToNumbers,
} = require("./utilsService");

/* =========================
   CONFIGURACIÓN
========================= */

// Coincidencias con 82 % o más se aceptan automáticamente.
const MIN_SIMILARITY = 0.82;

// Máximo permitido por producto.
const MAX_QUANTITY = 20;

const WORD_EQUIVALENTS = {
  kiero: "quiero",
  qiero: "quiero",
  keria: "queria",

  aguachiles: "aguachile",
  aguachilez: "aguachile",
  aguachles: "aguachile",

  verdes: "verde",
  berde: "verde",
  berdе: "verde",
  rojos: "rojo",
  negros: "negro",

  micheladas: "michelada",
  michelada: "michelada",
  michelitas: "michelada",
  michelita: "michelada",

  camarones: "camaron",
  camaron: "camaron",
  camarron: "camaron",
  camron: "camaron",

  cocteles: "coctel",
  cócteles: "coctel",

  ceviches: "ceviche",
  cebiche: "ceviche",
  cebiches: "ceviche",

  filetes: "filete",
  pulpos: "pulpo",

  empanizados: "empanizado",
  empanisado: "empanizado",
  empanisados: "empanizado",

  cervezas: "cerveza",
  coronas: "corona",

  cocas: "coca",
  cocacola: "coca cola",

  refrescos: "refresco",
  sodas: "refresco",

  aguas: "agua",

  piezas: "pieza",
  ordenes: "orden",
  órdenes: "orden",
  vasos: "vaso",
  litros: "litro",
};

/* =========================
   NORMALIZACIÓN
========================= */

function prepareText(value = "") {
  return normalize(wordsToNumbers(value))
    .replace(/coca[\s-]*cola/g, "coca cola")
    .split(" ")
    .filter(Boolean)
    .filter(
      word =>
        ![
          "de",
          "del",
          "los",
          "las",
          "el",
          "la",
          "unos",
          "unas",
          "porfavor",
        ].includes(word)
    )
    .map(word => WORD_EQUIVALENTS[word] || word)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   DISTANCIA DE LEVENSHTEIN
========================= */

function levenshteinDistance(first = "", second = "") {
  const a = String(first);
  const b = String(second);

  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from(
    { length: b.length + 1 },
    () => Array(a.length + 1).fill(0)
  );

  for (let column = 0; column <= a.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 0; row <= b.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let row = 1; row <= b.length; row += 1) {
    for (let column = 1; column <= a.length; column += 1) {
      const substitutionCost =
        a[column - 1] === b[row - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[b.length][a.length];
}

function similarity(first = "", second = "") {
  const a = prepareText(first);
  const b = prepareText(second);

  if (!a || !b) return 0;
  if (a === b) return 1;

  const longestLength = Math.max(a.length, b.length);

  if (!longestLength) return 1;

  return (
    1 -
    levenshteinDistance(a, b) /
      longestLength
  );
}

/* =========================
   CANTIDADES
========================= */

function getQuantityBefore(text, index) {
  const before = text.slice(
    Math.max(0, index - 55),
    index
  );

  const match = before.match(
    /(\d+)\s*(?:x|orden|pieza|vaso|litro)?\s*(?:y\s*)?$/
  );

  const quantity = Number(match?.[1] || 1);

  return Math.min(
    Math.max(quantity, 1),
    MAX_QUANTITY
  );
}

/* =========================
   CLAVES DEL PRODUCTO
========================= */

function getProductKeys(product) {
  return [
    product.name,
    ...(product.aliases || []),
  ]
    .map(prepareText)
    .filter(Boolean)
    .filter(
      (key, index, array) =>
        array.indexOf(key) === index
    )
    .sort((a, b) => b.length - a.length);
}

/* =========================
   FRAGMENTOS DEL MENSAJE
========================= */

function buildTextWindows(text, minWords, maxWords) {
  const words = text.split(" ").filter(Boolean);
  const windows = [];

  for (
    let start = 0;
    start < words.length;
    start += 1
  ) {
    for (
      let size = minWords;
      size <= maxWords;
      size += 1
    ) {
      const selected = words.slice(
        start,
        start + size
      );

      if (selected.length !== size) continue;

      windows.push({
        text: selected.join(" "),
        startWord: start,
        wordLength: size,
      });
    }
  }

  return windows;
}

function findCharacterIndex(
  normalizedText,
  fragment,
  startWord
) {
  const words = normalizedText
    .split(" ")
    .filter(Boolean);

  const prefix = words
    .slice(0, startWord)
    .join(" ");

  if (!prefix) {
    return normalizedText.indexOf(fragment);
  }

  return prefix.length + 1;
}

/* =========================
   COINCIDENCIA DE PRODUCTO
========================= */

function findBestMatchForProduct(
  normalizedText,
  product
) {
  const keys = getProductKeys(product);

  let bestMatch = null;

  for (const key of keys) {
    // Primero intenta coincidencia exacta.
    const exactIndex =
      normalizedText.indexOf(key);

    if (exactIndex !== -1) {
      const exactCandidate = {
        index: exactIndex,
        keyLength: key.length,
        similarity: 1,
        matchedText: key,
      };

      if (
        !bestMatch ||
        exactCandidate.keyLength >
          bestMatch.keyLength
      ) {
        bestMatch = exactCandidate;
      }

      continue;
    }

    const keyWordCount = key
      .split(" ")
      .filter(Boolean).length;

    const windows = buildTextWindows(
      normalizedText,
      Math.max(1, keyWordCount - 1),
      keyWordCount + 1
    );

    for (const window of windows) {
      const score = similarity(
        window.text,
        key
      );

      if (score < MIN_SIMILARITY) {
        continue;
      }

      const candidate = {
        index: findCharacterIndex(
          normalizedText,
          window.text,
          window.startWord
        ),
        keyLength: window.text.length,
        similarity: score,
        matchedText: window.text,
      };

      if (
        !bestMatch ||
        candidate.similarity >
          bestMatch.similarity ||
        (
          candidate.similarity ===
            bestMatch.similarity &&
          candidate.keyLength >
            bestMatch.keyLength
        )
      ) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

function rangesOverlap(first, second) {
  const firstEnd =
    first.index + first.keyLength;

  const secondEnd =
    second.index + second.keyLength;

  return (
    first.index < secondEnd &&
    second.index < firstEnd
  );
}

/* =========================
   DETECCIÓN PRINCIPAL
========================= */

function detectProducts(text = "", catalogProducts = products) {
  const normalizedText = prepareText(text);

  if (!normalizedText) {
    return [];
  }

  const candidates = [];

  for (const product of catalogProducts) {
    const match = findBestMatchForProduct(
      normalizedText,
      product
    );

    if (!match) continue;

    candidates.push({
      product,
      quantity: getQuantityBefore(
        normalizedText,
        match.index
      ),
      index: match.index,
      keyLength: match.keyLength,
      similarity: match.similarity,
      matchedText: match.matchedText,
    });
  }

  // Primero conserva coincidencias más seguras
  // y más específicas.
  candidates.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      b.keyLength - a.keyLength ||
      a.index - b.index
  );

  const selected = [];

  for (const candidate of candidates) {
    const alreadySelected = selected.some(
      item =>
        item.product.id ===
        candidate.product.id
    );

    const overlaps = selected.some(item =>
      rangesOverlap(item, candidate)
    );

    if (!alreadySelected && !overlaps) {
      selected.push(candidate);
    }
  }

  return selected.sort(
    (a, b) => a.index - b.index
  );
}

/* =========================
   SUGERENCIA
========================= */

function suggestProduct(text = "") {
  const normalizedText = prepareText(text);

  let bestSuggestion = null;

  for (const product of products) {
    for (const key of getProductKeys(product)) {
      const score = similarity(
        normalizedText,
        key
      );

      if (
        !bestSuggestion ||
        score > bestSuggestion.similarity
      ) {
        bestSuggestion = {
          product,
          similarity: score,
        };
      }
    }
  }

  return bestSuggestion;
}

module.exports = {
  detectProducts,
  suggestProduct,
  getQuantityBefore,
  prepareText,
  similarity,
};
