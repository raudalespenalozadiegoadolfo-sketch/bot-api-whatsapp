#!/usr/bin/env node

const { MongoClient, ObjectId } = require("mongodb");
const { products } = require("../services/menuService");

const DATABASE_NAME = "marisco_alegre_staging";
const TENANT_SLUG = "marisco-alegre";

function normalizeCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sourceCatalog() {
  const categories = [];
  const categoryKeys = new Set();
  const sourceProducts = products.map((product, order) => ({
    legacyId: String(product.id || "").trim(),
    name: String(product.name || "").trim(),
    category: String(product.category || "").trim(),
    type: product.type === "drink" ? "drink" : "food",
    price: Number(product.price || 0),
    order,
  }));

  for (const product of sourceProducts) {
    const key = normalizeCategory(product.category);
    if (!categoryKeys.has(key)) {
      categoryKeys.add(key);
      categories.push({ normalizedName: key, order: categories.length });
    }
  }

  return { categories, products: sourceProducts };
}

function countDuplicateGroups(records, keySelector) {
  const counts = new Map();
  for (const record of records) {
    const key = keySelector(record);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].filter(count => count > 1).length;
}

function buildSyncPlan({ source, categories, products: currentProducts, recordsOutsideExpectedTenant = 0 }) {
  const categoryByName = new Map(categories.map(category => [String(category.normalizedName || ""), category]));
  const productByLegacyId = new Map();
  for (const product of currentProducts) {
    if (product.legacyId) productByLegacyId.set(String(product.legacyId), product);
  }

  let existingCategories = 0;
  let missingCategories = 0;
  let categoryUpdates = 0;
  for (const category of source.categories) {
    const existing = categoryByName.get(category.normalizedName);
    if (!existing) missingCategories += 1;
    else {
      existingCategories += 1;
      if (existing.active === false || existing.order !== category.order) categoryUpdates += 1;
    }
  }

  let existingProducts = 0;
  let missingProducts = 0;
  let productUpdates = 0;
  for (const product of source.products) {
    const existing = productByLegacyId.get(product.legacyId);
    if (!existing) missingProducts += 1;
    else {
      existingProducts += 1;
      if (
        existing.source === "legacy" &&
        (existing.name !== product.name ||
          existing.category !== product.category ||
          Number(existing.price) !== product.price ||
          existing.type !== product.type ||
          existing.order !== product.order)
      ) productUpdates += 1;
    }
  }

  return {
    sourceCategories: source.categories.length,
    sourceProducts: source.products.length,
    existingCategories,
    existingProducts,
    missingCategories,
    missingProducts,
    updateCandidates: categoryUpdates + productUpdates,
    possibleDuplicates:
      countDuplicateGroups(categories, category => category.normalizedName) +
      countDuplicateGroups(currentProducts, product => product.legacyId),
    recordsOutsideExpectedTenant,
  };
}

async function readCollection(db, name, projection) {
  return db.collection(name).find({}, { projection }).toArray();
}

async function planLegacyCatalogSync(db) {
  const tenant = await db.collection("tenants").findOne(
    { slug: TENANT_SLUG },
    { projection: { _id: 1, slug: 1 } }
  );
  if (!tenant?._id) throw new Error(`No existe el tenant ${TENANT_SLUG}.`);

  const tenantId = tenant._id;
  const categories = await readCollection(db, "categorias", {
    _id: 0, tenantId: 1, normalizedName: 1, active: 1, order: 1,
  });
  const currentProducts = await readCollection(db, "productos", {
    _id: 0, tenantId: 1, legacyId: 1, source: 1, name: 1, category: 1,
    type: 1, price: 1, order: 1,
  });

  const expectedCategories = categories.filter(record => String(record.tenantId) === String(tenantId));
  const expectedProducts = currentProducts.filter(record => String(record.tenantId) === String(tenantId));
  const outside = categories.length - expectedCategories.length + currentProducts.length - expectedProducts.length;

  return {
    mode: "READ_ONLY",
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    ...buildSyncPlan({
      source: sourceCatalog(),
      categories: expectedCategories,
      products: expectedProducts,
      recordsOutsideExpectedTenant: outside,
    }),
  };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("Falta la variable de entorno MONGO_URI.");
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  try {
    console.log(JSON.stringify(await planLegacyCatalogSync(client.db(DATABASE_NAME)), null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  require("dotenv").config();
  main().catch(error => {
    console.error("No fue posible generar el preflight del catálogo legacy:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAME,
  TENANT_SLUG,
  buildSyncPlan,
  normalizeCategory,
  planLegacyCatalogSync,
  sourceCatalog,
};