function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPhone(value = "") {
  let n = String(value).replace(/\D/g, "");

  if (n.length === 10) {
    n = `521${n}`;
  }

  if (
    n.length === 12 &&
    n.startsWith("52") &&
    !n.startsWith("521")
  ) {
    n = `521${n.slice(2)}`;
  }

  return n;
}

function isThanks(text = "") {
  const t = normalize(text);

  return (
    t === "gracias" ||
    t === "muchas gracias" ||
    t.includes("gracias")
  );
}

function wordsToNumbers(text = "") {
  return normalize(text)
    .replace(/\buna\b/g, "1")
    .replace(/\bun\b/g, "1")
    .replace(/\bdos\b/g, "2")
    .replace(/\btres\b/g, "3")
    .replace(/\bcuatro\b/g, "4")
    .replace(/\bcinco\b/g, "5")
    .replace(/\bseis\b/g, "6")
    .replace(/\bsiete\b/g, "7")
    .replace(/\bocho\b/g, "8")
    .replace(/\bnueve\b/g, "9")
    .replace(/\bdiez\b/g, "10");
}

function publicBaseUrl(req) {
  const proto =
    req.get("x-forwarded-proto") ||
    req.protocol ||
    "http";

  return `${proto}://${req.get("host")}`;
}

module.exports = {
  normalize,
  cleanPhone,
  isThanks,
  wordsToNumbers,
  publicBaseUrl,
};