require("dotenv").config();

const env = {
  TOKEN: process.env.TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  WHATSAPP_BUSINESS_ACCOUNT_ID:
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  WHATSAPP_DISPLAY_PHONE_NUMBER:
    process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "",
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET,
  MONGO_URI: process.env.MONGO_URI,
  PANEL_API_KEY: process.env.PANEL_API_KEY || "",
  GRAPH_API_VERSION: process.env.GRAPH_API_VERSION || "v22.0",
  PORT: Number(process.env.PORT || 10000),
  STORE_URL:
    process.env.STORE_URL ||
    "http://localhost:10000/tienda",
  RESTAURANT_NAME:
    process.env.RESTAURANT_NAME ||
    "Marisco Alegre",
};

const requiredVariables = [
  "TOKEN",
  "PHONE_NUMBER_ID",
  "VERIFY_TOKEN",
  "APP_SECRET",
  "MONGO_URI",
];

for (const variable of requiredVariables) {
  if (!env[variable]) {
    throw new Error(
      `Falta la variable de entorno ${variable}`
    );
  }
}

module.exports = env;
