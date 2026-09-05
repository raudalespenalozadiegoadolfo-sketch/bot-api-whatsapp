#!/usr/bin/env node

const { MongoClient, ObjectId } = require("mongodb");

const DATABASE_NAME = "marisco_alegre_staging";
const COLLECTIONS = Object.freeze([
  "categorias",
  "productos",
  "combos",
  "cupons",
]);

function classifyTenantIds(documents) {
  const result = {
    total: documents.length,
    tenantIdObjectId: 0,
    tenantIdNull: 0,
    tenantIdMissing: 0,
    tenantIdInvalid: 0,
  };

  for (const document of documents) {
    if (!Object.prototype.hasOwnProperty.call(document, "tenantId")) {
      result.tenantIdMissing += 1;
    } else if (document.tenantId === null) {
      result.tenantIdNull += 1;
    } else if (document.tenantId instanceof ObjectId) {
      result.tenantIdObjectId += 1;
    } else {
      result.tenantIdInvalid += 1;
    }
  }

  return result;
}

async function auditCollection(db, collectionName) {
  if (!COLLECTIONS.includes(collectionName)) {
    throw new Error(`Colección no permitida: ${collectionName}`);
  }

  const documents = await db.collection(collectionName)
    .find({}, { projection: { _id: 0, tenantId: 1 } })
    .toArray();

  return classifyTenantIds(documents);
}

async function auditCatalog(db) {
  const collections = {};
  for (const collectionName of COLLECTIONS) {
    collections[collectionName] = await auditCollection(db, collectionName);
  }

  return {
    mode: "READ_ONLY",
    collections,
  };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("Falta la variable de entorno MONGO_URI.");
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await auditCatalog(client.db(DATABASE_NAME));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  require("dotenv").config();
  main().catch(error => {
    console.error("No fue posible auditar el catálogo legacy:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  COLLECTIONS,
  DATABASE_NAME,
  auditCatalog,
  auditCollection,
  classifyTenantIds,
};