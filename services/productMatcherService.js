const { products } = require("./menuService");
const { normalize, wordsToNumbers } = require("./utilsService");

function getQuantityBefore(text, index) {
  const before = text.slice(Math.max(0, index - 35), index);

  const match = before.match(
    /(\d+)\s*(?:x|de|orden(?:es)?|pieza(?:s)?|vaso(?:s)?|litro(?:s)?)?\s*$/
  );

  return Number(match?.[1] || 1);
}

function detectProducts(text) {
  const normalized = wordsToNumbers(text)
    .replace(/\bcocas?\b/g, "coca cola")
    .replace(/\bmichelitas?\b/g, "michelada")
    .replace(/\bcebiche\b/g, "ceviche");

  const detections = [];

  for (const product of products) {
    const keys = [product.name, ...(product.aliases || [])].map(normalize);

    for (const key of keys) {
      const index = normalized.indexOf(key);

      if (index !== -1) {
        detections.push({
          product,
          quantity: Math.min(
            Math.max(getQuantityBefore(normalized, index), 1),
            20
          ),
          index,
          keyLength: key.length,
        });

        break;
      }
    }
  }

  const unique = new Map();

  detections
    .sort((a, b) => a.index - b.index || b.keyLength - a.keyLength)
    .forEach(item => {
      if (!unique.has(item.product.id)) {
        unique.set(item.product.id, item);
      }
    });

  return [...unique.values()];
}

module.exports = {
  detectProducts,
  getQuantityBefore,
};