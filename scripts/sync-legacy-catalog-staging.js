#!/usr/bin/env node

const { MongoClient } = require("mongodb");
const { sourceCatalog, normalizeCategory } = require("./plan-legacy-catalog-sync");

const DATABASE_NAME = "marisco_alegre_staging";
const TENANT_SLUG = "marisco-alegre";

const ERROR_CODES = Object.freeze({
  MONGO_URI_MISSING: "MONGO_URI_MISSING",
  WRONG_DATABASE: "WRONG_DATABASE",
  TENANT_NOT_FOUND: "TENANT_NOT_FOUND",
  DUPLICATE_TENANT: "DUPLICATE_TENANT",
  AMBIGUOUS_CATEGORY: "AMBIGUOUS_CATEGORY",
  DUPLICATE_PRODUCT: "DUPLICATE_PRODUCT",
  CROSS_TENANT_CATEGORY: "CROSS_TENANT_CATEGORY",
  INVALID_SOURCE: "INVALID_SOURCE",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  APPLY_FAILED: "APPLY_FAILED",
});

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function sourceDocuments() {
  const source = sourceCatalog();
  const sourceNames = new Map();
  for (const product of source.products) {
    const name = cleanText(product.category);
    sourceNames.set(normalizeCategory(name), name);
  }
  if (source.categories.length !== 11 || source.products.length !== 42) {
    throw new Error(ERROR_CODES.INVALID_SOURCE);
  }

  const categories = source.categories.map(category => ({
    name: sourceNames.get(normalizeCategory(category.normalizedName)) || "",
    normalizedName: normalizeCategory(category.normalizedName),
    order: category.order,
  }));

  const products = source.products.map(product => ({
    legacyId: cleanText(product.legacyId),
    name: cleanText(product.name),
    category: cleanText(product.category),
    price: product.price,
    type: product.type === "drink" ? "drink" : "food",
    aliases: Array.isArray(product.aliases) ? product.aliases : [],
    order: product.order,
  }));

  if (
    categories.some(category => !category.name || !category.normalizedName) ||
    products.some(product =>
      !product.legacyId ||
      !product.name ||
      !product.category ||
      !Number.isFinite(product.price) ||
      product.price < 0
    )
  ) {
    throw new Error(ERROR_CODES.INVALID_SOURCE);
  }

  return { categories, products };
}

function output({ mode, source, categoriesToCreate, categoriesToUpdate, productsToCreate, productsToUpdate, duplicatesDetected = 0, crossTenantConflicts = 0, status }) {
  return {
    mode,
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    sourceCategories: source.categories.length,
    sourceProducts: source.products.length,
    categoriesToCreate,
    categoriesToUpdate,
    productsToCreate,
    productsToUpdate,
    duplicatesDetected,
    crossTenantConflicts,
    status,
  };
}

function createCategoryDocument(tenantId, category) {
  return {
    tenantId,
    name: category.name,
    normalizedName: category.normalizedName,
    active: true,
    order: category.order,
  };
}

function createProductDocument(tenantId, product, categoryName) {
  return {
    tenantId,
    legacyId: product.legacyId,
    name: product.name,
    category: categoryName,
    price: product.price,
    type: product.type,
    description: "",
    imageUrl: "",
    aliases: product.aliases,
    active: true,
    order: product.order,
    source: "legacy",
  };
}

function sameId(left, right) {
  return String(left) === String(right);
}

function applyError(error, collection, operation) {
  const diagnostic = new Error(ERROR_CODES.APPLY_FAILED);
  diagnostic.stage = "APPLY";
  diagnostic.collection = collection;
  diagnostic.operation = operation;
  if (Number.isInteger(error?.code)) diagnostic.mongoCode = error.code;
  if (typeof error?.codeName === "string") diagnostic.mongoCodeName = error.codeName;
  if (error?.keyPattern && typeof error.keyPattern === "object") {
    diagnostic.keyPattern = Object.keys(error.keyPattern);
  }
  return diagnostic;
}

function buildSyncPlan({ tenantId, source, categories, products }) {
  const targetCategories = categories.filter(category => sameId(category.tenantId, tenantId));
  const targetProducts = products.filter(product => sameId(product.tenantId, tenantId));
  const crossTenantConflicts = categories.length - targetCategories.length + products.length - targetProducts.length;
  const categoryByName = new Map();
  const productByLegacyId = new Map();

  for (const category of targetCategories) {
    const key = cleanText(category.normalizedName);
    const matches = categoryByName.get(key) || [];
    matches.push(category);
    categoryByName.set(key, matches);
  }
  for (const matches of categoryByName.values()) {
    if (matches.length > 1) throw new Error(ERROR_CODES.AMBIGUOUS_CATEGORY);
  }

  for (const product of targetProducts) {
    const key = cleanText(product.legacyId);
    if (!key) continue;
    const matches = productByLegacyId.get(key) || [];
    matches.push(product);
    productByLegacyId.set(key, matches);
  }
  for (const matches of productByLegacyId.values()) {
    if (matches.length > 1) throw new Error(ERROR_CODES.DUPLICATE_PRODUCT);
  }

  const categoryCreates = [];
  const categoryUpdates = [];
  const categoryNames = new Map();
  for (const category of source.categories) {
    if (categoryNames.has(category.normalizedName)) throw new Error(ERROR_CODES.AMBIGUOUS_CATEGORY);
    categoryNames.set(category.normalizedName, category);
    const existing = categoryByName.get(category.normalizedName)?.[0];
    if (!existing) categoryCreates.push(category);
    else if (existing.active === false || existing.order !== category.order) {
      categoryUpdates.push({
        filter: { _id: existing._id, tenantId },
        update: { $set: { active: true, order: category.order } },
      });
    }
  }

  const resolvedCategories = new Map();
  for (const category of source.categories) {
    const existing = categoryByName.get(category.normalizedName)?.[0];
    resolvedCategories.set(category.normalizedName, existing ? existing.name : category.name);
  }

  const productCreates = [];
  const productUpdates = [];
  const sourceProductIds = new Set();
  for (const product of source.products) {
    if (sourceProductIds.has(product.legacyId)) throw new Error(ERROR_CODES.DUPLICATE_PRODUCT);
    sourceProductIds.add(product.legacyId);
    const categoryName = resolvedCategories.get(normalizeCategory(product.category));
    if (!categoryName) throw new Error(ERROR_CODES.CROSS_TENANT_CATEGORY);

    const legacyMatches = productByLegacyId.get(product.legacyId) || [];
    const nameMatches = targetProducts.filter(candidate =>
      cleanText(candidate.name).toLowerCase() === product.name.toLowerCase() &&
      normalizeCategory(candidate.category) === normalizeCategory(categoryName)
    );
    if (legacyMatches.length && nameMatches.length && !nameMatches.some(match => sameId(match._id, legacyMatches[0]._id))) {
      throw new Error(ERROR_CODES.DUPLICATE_PRODUCT);
    }
    if (nameMatches.length > 1) throw new Error(ERROR_CODES.DUPLICATE_PRODUCT);
    const existing = legacyMatches[0] || nameMatches[0];
    if (!existing) {
      productCreates.push(createProductDocument(tenantId, product, categoryName));
      continue;
    }

    if (existing.source !== "legacy") continue;
    const update = {};
    if (!existing.legacyId) update.legacyId = product.legacyId;
    if (existing.name !== product.name) update.name = product.name;
    if (existing.category !== categoryName) update.category = categoryName;
    if (Number(existing.price) !== product.price) update.price = product.price;
    if (existing.type !== product.type) update.type = product.type;
    if (JSON.stringify(existing.aliases || []) !== JSON.stringify(product.aliases)) update.aliases = product.aliases;
    if (existing.order !== product.order) update.order = product.order;
    if (Object.keys(update).length) {
      productUpdates.push({
        filter: { _id: existing._id, tenantId, source: "legacy", legacyId: product.legacyId },
        update: { $set: update },
      });
    }
  }

  return {
    source,
    tenantId,
    categoryCreates,
    categoryUpdates,
    productCreates,
    productUpdates,
    crossTenantConflicts,
    duplicatesDetected: 0,
  };
}

async function readAll(db, name, projection) {
  return db.collection(name).find({}, { projection }).toArray();
}

async function buildPlan(db) {
  if (!db || db.databaseName !== DATABASE_NAME) throw new Error(ERROR_CODES.WRONG_DATABASE);
  const tenantMatches = await db.collection("tenants").find(
    { slug: TENANT_SLUG },
    { projection: { _id: 1, slug: 1 } }
  ).toArray();
  if (!tenantMatches.length) throw new Error(ERROR_CODES.TENANT_NOT_FOUND);
  if (tenantMatches.length > 1) throw new Error(ERROR_CODES.DUPLICATE_TENANT);

  const source = sourceDocuments();
  const categories = await readAll(db, "categorias", { _id: 1, tenantId: 1, name: 1, normalizedName: 1, active: 1, order: 1 });
  const products = await readAll(db, "productos", { _id: 1, tenantId: 1, legacyId: 1, source: 1, name: 1, category: 1, price: 1, type: 1, aliases: 1, order: 1 });
  return buildSyncPlan({ tenantId: tenantMatches[0]._id, source, categories, products });
}

function dryRunResult(plan) {
  return output({
    mode: "DRY_RUN",
    source: plan.source,
    categoriesToCreate: plan.categoryCreates.length,
    categoriesToUpdate: plan.categoryUpdates.length,
    productsToCreate: plan.productCreates.length,
    productsToUpdate: plan.productUpdates.length,
    duplicatesDetected: plan.duplicatesDetected,
    crossTenantConflicts: plan.crossTenantConflicts,
    status: "READY",
  });
}

async function applyPlan(db, plan) {
  for (const category of plan.categoryCreates) {
    try {
      await db.collection("categorias").insertOne(createCategoryDocument(plan.tenantId, category));
    } catch (error) {
      throw applyError(error, "categorias", "insertOne");
    }
  }
  for (const categoryUpdate of plan.categoryUpdates) {
    try {
      await db.collection("categorias").updateOne(categoryUpdate.filter, categoryUpdate.update);
    } catch (error) {
      throw applyError(error, "categorias", "updateOne");
    }
  }
  for (const product of plan.productCreates) {
    try {
      await db.collection("productos").insertOne(product);
    } catch (error) {
      throw applyError(error, "productos", "insertOne");
    }
  }
  for (const productUpdate of plan.productUpdates) {
    try {
      await db.collection("productos").updateOne(productUpdate.filter, productUpdate.update);
    } catch (error) {
      throw applyError(error, "productos", "updateOne");
    }
  }

  return {
    mode: "APPLY",
    database: DATABASE_NAME,
    tenantSlug: TENANT_SLUG,
    categoriesCreated: plan.categoryCreates.length,
    categoriesUpdated: plan.categoryUpdates.length,
    productsCreated: plan.productCreates.length,
    productsUpdated: plan.productUpdates.length,
    status: "COMPLETED",
  };
}

async function syncLegacyCatalog({ db, apply = false }) {
  const plan = await buildPlan(db);
  return apply ? applyPlan(db, plan) : dryRunResult(plan);
}

async function run({ uri, apply = false, MongoClientClass = MongoClient }) {
  if (!uri) throw new Error(ERROR_CODES.MONGO_URI_MISSING);
  let client;
  try {
    client = new MongoClientClass(uri);
    await client.connect();
    const db = client.db(DATABASE_NAME);
    return await syncLegacyCatalog({ db, apply });
  } catch (error) {
    if (Object.values(ERROR_CODES).includes(error.message)) throw error;
    throw new Error(apply ? ERROR_CODES.APPLY_FAILED : ERROR_CODES.CONNECTION_FAILED);
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

function parseArguments(args = []) {
  const unknown = args.filter(argument => argument !== "--apply");
  if (unknown.length) throw new Error("INVALID_ARGUMENT");
  return { apply: args.includes("--apply") };
}

async function main(args = process.argv.slice(2), environment = process.env) {
  return run({ uri: environment.MONGO_URI, apply: parseArguments(args).apply });
}

if (require.main === module) {
  require("dotenv").config();
  main()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      const code = Object.values(ERROR_CODES).includes(error.message) ? error.message : "CONNECTION_FAILED";
      const safeError = { ok: false, code };
      for (const field of ["stage", "collection", "operation", "mongoCode", "mongoCodeName", "keyPattern"]) {
        if (error[field] !== undefined) safeError[field] = error[field];
      }
      console.error(JSON.stringify(safeError));
      process.exitCode = 1;
    });
}

module.exports = {
  DATABASE_NAME,
  ERROR_CODES,
  TENANT_SLUG,
  applyPlan,
  buildPlan,
  buildSyncPlan,
  main,
  parseArguments,
  run,
  sourceDocuments,
  syncLegacyCatalog,
};