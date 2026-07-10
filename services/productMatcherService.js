const { products } = require("./menuService");
const { normalize, wordsToNumbers } = require("./utilsService");

const WORD_EQUIVALENTS = {
  aguachiles: "aguachile",
  verdes: "verde",
  rojos: "rojo",
  negros: "negro",

  micheladas: "michelada",
  camarones: "camaron",
  empanizados: "empanizado",

  cocteles: "coctel",
  ceviches: "ceviche",
  filetes: "filete",
  pulpos: "pulpo",

  cervezas: "cerveza",
  coronas: "corona",
  refrescos: "refresco",

  aguas: "agua",
  cocas: "coca",

  piezas: "pieza",
  ordenes: "orden",
  vasos: "vaso",
  litros: "litro",
};

function prepareText(value = "") {
  return normalize(wordsToNumbers(value))
    .split(" ")
    .filter(Boolean)
    .filter(word => !["de", "del", "los", "las", "el", "la"].includes(word))
    .map(word => WORD_EQUIVALENTS[word] || word)
    .join(" ")
    .replace(/\bmichelitas?\b/g, "michelada")
    .replace(/\bcebiche\b/g, "ceviche")
    .replace(/\s+/g, " ")
    .trim();
}

function getQuantityBefore(text, index) {
  const before = text.slice(Math.max(0, index - 50), index);

  const match = before.match(
    /(\d+)\s*(?:x|orden|pieza|vaso|litro)?\s*(?:y\s*)?$/
  );

  const quantity = Number(match?.[1] || 1);

  return Math.min(Math.max(quantity, 1), 20);
}

function getProductKeys(product) {
  return [product.name, ...(product.aliases || [])]
    .map(prepareText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function rangesOverlap(first, second) {
  const firstEnd = first.index + first.keyLength;
  const secondEnd = second.index + second.keyLength;

  return first.index < secondEnd && second.index < firstEnd;
}

function detectProducts(text = "") {
  const normalizedText = prepareText(text);
  const candidates = [];

  for (const product of products) {
    for (const key of getProductKeys(product)) {
      const index = normalizedText.indexOf(key);

      if (index === -1) continue;

      candidates.push({
        product,
        quantity: getQuantityBefore(normalizedText, index),
        index,
        keyLength: key.length,
      });

      break;
    }
  }

  // Primero conserva las coincidencias más específicas.
  candidates.sort(
    (a, b) => b.keyLength - a.keyLength || a.index - b.index
  );

  const selected = [];

  for (const candidate of candidates) {
    const duplicated = selected.some(
      item => item.product.id === candidate.product.id
    );

    const overlapping = selected.some(item =>
      rangesOverlap(item, candidate)
    );

    if (!duplicated && !overlapping) {
      selected.push(candidate);
    }
  }

  return selected.sort((a, b) => a.index - b.index);
}

module.exports = {
  detectProducts,
  getQuantityBefore,
  prepareText,
};