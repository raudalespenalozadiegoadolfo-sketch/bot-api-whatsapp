require("dotenv").config();

const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");

const webhookRoutes = require("./routes/webhookRoutes");
const Cliente = require("./models/Cliente");
const ProcessedMessage = require("./models/ProcessedMessage");
const {
  detectProducts,
} = require("./services/productMatcherService");

const app = express();

app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buffer) => {
    req.rawBody = buffer;
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.use(webhookRoutes);

const {
  TOKEN,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  APP_SECRET,
  MONGO_URI,
  PANEL_API_KEY,
  GRAPH_API_VERSION = "v22.0",
  PORT = 10000,
  STORE_URL,
  RESTAURANT_NAME = "Marisco Alegre",
} = process.env;

const REQUIRED_ENV = { TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, APP_SECRET, MONGO_URI };

for (const [name, value] of Object.entries(REQUIRED_ENV)) {
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
}

/* =========================
   MENÚ
========================= */

const products = [
  ["food", "Camarones", "Camarones a la diabla", 180, ["diabla", "camarones diabla"]],
  ["food", "Camarones", "Camarones empanizados", 190, ["camaron empanizado", "camarones empanizados"]],
  ["food", "Camarones", "Camarones al ajo", 180, ["ajo", "camarones ajo"]],
  ["food", "Camarones", "Camarones al ajillo", 180, ["ajillo", "camarones ajillo"]],
  ["food", "Pulpo", "Pulpo a la diabla", 220, ["pulpo diabla"]],
  ["food", "Pulpo", "Pulpo empanizado", 220, ["pulpo empanizado"]],
  ["food", "Pulpo", "Pulpo zarandeado", 220, ["pulpo zarandeado"]],
  ["food", "Filete", "Filete a la diabla", 160, ["filete diabla"]],
  ["food", "Filete", "Filete empanizado", 170, ["filete empanizado"]],
  ["food", "Filete", "Filete al ajo", 170, ["filete ajo"]],
  ["food", "Cocteles", "Coctel de camarón", 190, ["coctel camaron", "cóctel de camarón"]],
  ["food", "Cocteles", "Coctel de pulpo", 200, ["coctel pulpo"]],
  ["food", "Cocteles", "Coctel de callo", 250, ["coctel callo"]],
  ["food", "Cocteles", "Coctel mixto", 220, ["coctel mixto"]],
  ["food", "Ceviches", "Ceviche de pescado", 180, ["ceviche pescado"]],
  ["food", "Ceviches", "Ceviche de camarón", 200, ["ceviche camaron"]],
  ["food", "Aguachiles", "Aguachile verde", 190, ["aguachile verde"]],
  ["food", "Aguachiles", "Aguachile rojo", 190, ["aguachile rojo"]],
  ["food", "Aguachiles", "Aguachile negro", 190, ["aguachile negro"]],
  ["food", "Cortes", "Arrachera", 220, ["arrachera"]],
  ["food", "Cortes", "T-bone", 250, ["t bone", "tbone"]],
  ["food", "Cortes", "Rib eye", 270, ["ribeye", "rib eye"]],
  ["drink", "Refrescos", "Coca Cola", 30, ["coca", "coca cola"]],
  ["drink", "Refrescos", "Coca Cola Light", 30, ["coca light", "coca cola light"]],
  ["drink", "Refrescos", "Pepsi", 25, ["pepsi"]],
  ["drink", "Refrescos", "Sangría", 25, ["sangria"]],
  ["drink", "Refrescos", "7Up", 25, ["7up", "seven"]],
  ["drink", "Aguas", "Agua de jamaica", 35, ["jamaica", "agua jamaica"]],
  ["drink", "Aguas", "Agua de arroz", 35, ["arroz", "agua de arroz", "horchata"]],
  ["drink", "Aguas", "Agua de piña", 35, ["piña", "pina", "agua piña"]],
  ["drink", "Aguas", "Agua de limón", 35, ["limon", "limón", "agua limon"]],
  ["drink", "Micheladas", "Michelada de camarón", 100, ["michelada camaron"]],
  ["drink", "Micheladas", "Michelada Clamato", 80, ["michelada clamato", "clamato"]],
  ["drink", "Micheladas", "Michelada tamarindo", 90, ["michelada tamarindo"]],
  ["drink", "Cervezas", "Corona Extra", 40, ["corona", "corona extra"]],
  ["drink", "Cervezas", "Corona Light", 40, ["corona light"]],
  ["drink", "Cervezas", "Corona Cero", 40, ["corona cero"]],
  ["drink", "Cervezas", "Tecate", 35, ["tecate"]],
  ["drink", "Cervezas", "Tecate Light", 35, ["tecate light"]],
  ["drink", "Cervezas", "Indio", 30, ["indio"]],
  ["drink", "Cervezas", "Ultra", 30, ["ultra"]],
  ["drink", "Cervezas", "Heineken Cero", 35, ["heineken cero"]],
].map(([type, category, name, price, aliases], index) => ({
  id: `p${index}`,
  type,
  category,
  name,
  price,
  aliases
}));

/* =========================
   MODELOS
========================= */

const {
  normalize,
  cleanPhone,
  isThanks,
  wordsToNumbers,
  publicBaseUrl,
} = require("./services/utilsService");

/* =========================
   UTILIDADES
========================= */



const totalOf = (cliente) =>
  cliente.pedidos.reduce((sum, item) => sum + item.precio * item.cantidad, 0);

function clearDraftOrder(cliente) {
  // Limpia solo carritos no confirmados.
  // No borra pedidos reales en confirmado, cocina o en camino.
  if (cliente.estadoPedido === "armando") {
    cliente.pedidos = [];
    cliente.productoPendiente = null;
    cliente.paso = "inicio";
    cliente.estadoPedido = "sin_pedido";
    cliente.ultimaActividad = new Date();
    return true;
  }

  return false;
}

function makeOrderId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}


function storeUrl() {
  return STORE_URL || "http://localhost:10000/tienda";
}





function addProduct(cliente, product, quantity = 1) {
  const existing = cliente.pedidos.find(item => item.productId === product.id);

  if (existing) {
    existing.cantidad += quantity;
  } else {
    cliente.pedidos.push({
      productId: product.id,
      nombre: product.name,
      precio: product.price,
      cantidad: quantity,
    });
  }

  cliente.estadoPedido = "armando";
  cliente.ultimaActividad = new Date();
}

function ticket(cliente, confirmed = false) {
  const title = confirmed ? "✅ *PEDIDO RECIBIDO*" : "🧾 *TU PEDIDO*";
  const lines = cliente.pedidos.map(item =>
    `• ${item.cantidad}x ${item.nombre} — $${item.precio * item.cantidad}`
  );

  return `${title}
──────────────
${lines.join("\n")}
──────────────
💰 *TOTAL: $${totalOf(cliente)}*
${confirmed ? "\nTu pedido fue recibido. Te avisaremos cuando esté en cocina y cuando vaya en camino." : ""}`;
}

/* =========================
   WHATSAPP
========================= */

async function sendPayload(to, payload) {
  await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, ...payload },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
}

const sendText = (to, body) =>
  sendPayload(to, { type: "text", text: { body } });

const sendButtons = (to, body, buttons) => sendPayload(to, {
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: {
      buttons: buttons.slice(0, 3).map(({ id, title }) => ({
        type: "reply",
        reply: { id, title: title.slice(0, 20) }
      }))
    },
  },
});

const sendList = (to, header, body, button, rows) => sendPayload(to, {
  type: "interactive",
  interactive: {
    type: "list",
    header: { type: "text", text: header.slice(0, 60) },
    body: { text: body },
    action: {
      button: button.slice(0, 20),
      sections: [{
        title: header.slice(0, 24),
        rows: rows.slice(0, 10).map(row => ({
          id: row.id,
          title: row.title.slice(0, 24),
          description: (row.description || "").slice(0, 72)
        }))
      }]
    },
  },
});

async function welcome(numero, cliente) {
  const greeting = cliente.nombre ? `¡Hola, ${cliente.nombre}!` : "¡Hola!";

  const hadDraft = clearDraftOrder(cliente);
  if (hadDraft) await cliente.save();

  await sendList(
    numero,
    RESTAURANT_NAME,
    `${greeting} Bienvenido a ${RESTAURANT_NAME}. ¿Qué deseas hacer?`,
    "Ver opciones",
    [
      { id: "show_menu", title: "🍽️ Ver menú", description: "Ordenar por WhatsApp" },
      { id: "store_link", title: "🌐 Tienda online", description: "Abrir menú web con + y -" },
      { id: "show_cart", title: "🛒 Mi carrito", description: "Revisar productos agregados" },
      { id: "order_status", title: "📦 Mi pedido", description: "Consultar estado del pedido" },
    ]
  );

  return sendText(numero, `🌐 También puedes pedir directo en nuestra tienda online. Solo presiona el link:
${storeUrl()}`);
}
function showMenu(numero) {
  return sendButtons(numero, "Elige una sección:", [
    { id: "type_food", title: "🍴 Comida" },
    { id: "type_drink", title: "🥤 Bebidas" },
  ]);
}

function showCategories(numero, type) {
  const categories = [...new Set(products.filter(p => p.type === type).map(p => p.category))];

  const rows = categories.map((category, index) => ({
    id: `category_${type}_${index}`,
    title: category,
    description: "Ver productos disponibles",
  }));

  return sendList(
    numero,
    type === "food" ? "Comida" : "Bebidas",
    "Selecciona una categoría",
    "Ver categorías",
    rows
  );
}

function showProducts(numero, type, categoryIndex) {
  const categories = [...new Set(products.filter(p => p.type === type).map(p => p.category))];
  const category = categories[categoryIndex];

  if (!category) return showMenu(numero);

  const rows = products
    .filter(p => p.type === type && p.category === category)
    .map(p => ({
      id: `product_${p.id}`,
      title: p.name,
      description: `$${p.price}`,
    }));

  return sendList(numero, category, "Selecciona un producto", "Ver productos", rows);
}

function extractInput(message) {
  if (message.type === "text") return { kind: "text", value: message.text.body.trim() };
  if (message.type === "location") return { kind: "location", value: message.location };

  const interactive = message.interactive;
  if (interactive?.button_reply) return { kind: "button", value: interactive.button_reply.id };
  if (interactive?.list_reply) return { kind: "list", value: interactive.list_reply.id };

  return { kind: "unsupported", value: "" };
}

/* =========================
   DETECCIÓN DE PEDIDOS
========================= */


/* =========================
   FLUJO DEL BOT
========================= */

async function confirmOrder(cliente) {
  if (!cliente.pedidos.length) {
    return sendText(cliente.numero, "Tu carrito está vacío.");
  }

  if (!cliente.nombre) {
    cliente.paso = "esperando_nombre";
    await cliente.save();
    return sendText(cliente.numero, "¿A nombre de quién será el pedido?");
  }

  if (!cliente.direccion) {
    cliente.paso = "esperando_ubicacion";
    await cliente.save();
    return sendText(cliente.numero, "Compárteme tu ubicación usando el clip de WhatsApp.");
  }

  cliente.paso = "confirmando_direccion";
  await cliente.save();

  return sendButtons(cliente.numero, "¿Usamos tu ubicación anterior?", [
    { id: "address_yes", title: "Sí" },
    { id: "address_no", title: "No" },
  ]);
}

async function finalizeOrder(cliente) {
  cliente.paso = "inicio";
  cliente.estadoPedido = "confirmado";
  cliente.horaConfirmacion = new Date();
  cliente.ultimaActividad = new Date();
  cliente.productoPendiente = null;

  await cliente.save();

  return sendText(cliente.numero, ticket(cliente, true));
}

async function handleIncoming(message) {
  try {
    await ProcessedMessage.create({ messageId: message.id });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }

  const numero = message.from;
  const input = extractInput(message);

  const cliente = await Cliente.findOneAndUpdate(
    { numero },
    { $setOnInsert: { numero }, $set: { ultimaActividad: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const command = input.value;
  const text = normalize(command);

  // PRO 6.3: agradecer nunca debe reiniciar menú ni tomarse como nombre.
  if (input.kind === "text" && isThanks(text)) {
    return sendText(numero, "😊 Gracias a usted por su preferencia. Aquí estaremos cuando guste ordenar nuevamente 🙌");
  }

  if (input.kind === "location") {
    if (cliente.paso !== "esperando_ubicacion") {
      return sendText(numero, "Recibí tu ubicación. Confirma primero tu pedido desde el carrito.");
    }

    cliente.direccion = {
      latitude: input.value.latitude,
      longitude: input.value.longitude,
    };

    return finalizeOrder(cliente);
  }

  if (cliente.paso === "esperando_nombre" && input.kind === "text") {
    cliente.nombre = input.value.slice(0, 80);
    cliente.paso = cliente.direccion ? "confirmando_direccion" : "esperando_ubicacion";

    await cliente.save();

    return cliente.direccion
      ? sendButtons(numero, "¿Usamos tu ubicación anterior?", [
          { id: "address_yes", title: "Sí" },
          { id: "address_no", title: "No" },
        ])
      : sendText(numero, `Gracias, ${cliente.nombre}. Ahora compárteme tu ubicación.`);
  }

  if (cliente.paso === "esperando_cantidad" && (input.kind === "text" || input.kind === "button")) {
    const cantidad = command.startsWith("quantity_")
      ? parseInt(command.replace("quantity_", ""), 10)
      : parseInt(text, 10);

    if (!cantidad || cantidad < 1 || cantidad > 20) {
      return sendText(numero, "Por favor escribe una cantidad válida. Ejemplo: 1, 2, 3...");
    }

    const product = cliente.productoPendiente;

    if (!product) {
      cliente.paso = "inicio";
      cliente.productoPendiente = null;
      await cliente.save();
      return sendText(numero, "No encontré el producto pendiente. Vuelve a seleccionar del menú.");
    }

    addProduct(cliente, product, cantidad);
    cliente.productoPendiente = null;
    cliente.paso = "inicio";
    await cliente.save();

    return sendButtons(numero, `✅ Agregado: ${cantidad}x ${product.name}\n💰 Total: $${totalOf(cliente)}`, [
      { id: "show_menu", title: "➕ Agregar más" },
      { id: "show_cart", title: "🛒 Ver carrito" },
      { id: "confirm_order", title: "✅ Confirmar" },
    ]);
  }

  if (command === "address_yes") return finalizeOrder(cliente);

  if (command === "address_no") {
    cliente.paso = "esperando_ubicacion";
    await cliente.save();
    return sendText(numero, "Compárteme la nueva ubicación.");
  }

  if (command === "show_menu" || ["menu", "ver menu", "menú"].includes(text)) {
    const hadDraft = clearDraftOrder(cliente);
    if (hadDraft) await cliente.save();
    return showMenu(numero);
  }

  if (command === "store_link" || text.includes("tienda") || text.includes("linea") || text.includes("online")) {
    return sendText(numero, `🌐 Tienda online:
${storeUrl()}

Cuando confirmes el carrito, el pedido llegará a este chat para finalizar tus datos.`);
  }

  if (command === "type_food") return showCategories(numero, "food");
  if (command === "type_drink") return showCategories(numero, "drink");

  if (command.startsWith("category_")) {
    const [, type, index] = command.split("_");
    return showProducts(numero, type, Number(index));
  }

  if (command.startsWith("product_")) {
    if (["cocina", "en_camino"].includes(cliente.estadoPedido)) {
      return sendText(numero, "Tu pedido actual ya está en proceso.");
    }

    const product = products.find(p => p.id === command.replace("product_", ""));
    if (!product) return showMenu(numero);

    cliente.productoPendiente = {
      id: product.id,
      type: product.type,
      category: product.category,
      name: product.name,
      price: product.price,
      aliases: product.aliases || [],
    };
    cliente.paso = "esperando_cantidad";
    cliente.ultimaActividad = new Date();
    await cliente.save();

    return sendText(numero, `Seleccionaste: ${product.name}\nPrecio: $${product.price}\n\n¿Cuántos deseas?`);
  }

  if (command === "show_cart" || text.includes("carrito") || text.includes("ticket")) {
    if (!cliente.pedidos.length) return sendText(numero, "Tu carrito está vacío.");

    return sendButtons(numero, ticket(cliente), [
      { id: "confirm_order", title: "✅ Confirmar" },
      { id: "empty_cart", title: "🗑️ Vaciar" },
    ]);
  }

  if (command === "confirm_order" || text === "confirmar" || text.includes("finalizar")) {
    return confirmOrder(cliente);
  }

  if (command === "empty_cart" || text === "cancelar" || text.includes("vaciar")) {
    cliente.pedidos = [];
    cliente.estadoPedido = "sin_pedido";
    cliente.paso = "inicio";
    cliente.productoPendiente = null;
    await cliente.save();

    return sendText(numero, "Tu carrito quedó vacío.");
  }

  if (command === "order_status" || text.includes("mi pedido") || text.includes("va mi pedido") || text.includes("cuanto tarda")) {
    const labels = {
      sin_pedido: "No tienes un pedido activo.",
      armando: "Tu pedido aún no está confirmado.",
      confirmado: "Tu pedido fue recibido. En breve pasará a cocina.",
      cocina: "Tu pedido está en cocina.",
      en_camino: "Tu pedido va en camino."
    };

    return sendText(numero, labels[cliente.estadoPedido]);
  }

  if (["hola", "buenas", "hey", "inicio"].some(word => text.includes(word))) {
    return welcome(numero, cliente);
  }

  if (input.kind === "text") {
    const detected = detectProducts(command);

    if (detected.length) {
      if (["cocina", "en_camino"].includes(cliente.estadoPedido)) {
        return sendText(numero, "Tu pedido actual ya está en proceso.");
      }

      detected.forEach(({ product, quantity }) => addProduct(cliente, product, quantity));
      await cliente.save();

      const resumen = detected.map(({ product, quantity }) => `• ${quantity}x ${product.name}`).join("\n");

      return sendButtons(numero, `✅ Agregué a tu carrito:\n${resumen}\n\n💰 Total: $${totalOf(cliente)}`, [
        { id: "show_menu", title: "➕ Agregar más" },
        { id: "show_cart", title: "🛒 Ver carrito" },
        { id: "confirm_order", title: "✅ Confirmar" },
      ]);
    }
  }

  return welcome(numero, cliente);
}

/* =========================
   PANEL + API
========================= */

app.get("/", (_req, res) => res.redirect("/panel"));

app.get("/panel", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "panel.html"));
});

app.get("/tienda", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "tienda.html"));
});

app.get("/api/menu", (_req, res) => {
  const categories = [...new Set(products.map(p => p.category))];
  res.json({ categories, products });
});

app.post("/api/tienda/pedido", async (req, res, next) => {
  try {
    const numero = cleanPhone(req.body.numero);
    const nombre = String(req.body.nombre || "").trim().slice(0, 80);
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!numero) return res.status(400).json({ error: "Número inválido" });
    if (!items.length) return res.status(400).json({ error: "El carrito está vacío" });

    const cliente = await Cliente.findOneAndUpdate(
      { numero },
      {
        $setOnInsert: { numero },
        $set: {
          ultimaActividad: new Date(),
          ...(nombre ? { nombre } : {}),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (["confirmado", "cocina", "en_camino"].includes(cliente.estadoPedido)) {
      return res.status(409).json({ error: "Ya tienes un pedido activo. Finalízalo, entrégalo o cancélalo antes de iniciar otro." });
    }

    // PRO 6.3: cada compra de tienda empieza carrito limpio.
    // Evita reutilizar productos de pedidos viejos sin confirmar.
    cliente.pedidos = [];
    cliente.estadoPedido = "sin_pedido";
    cliente.paso = "inicio";
    cliente.productoPendiente = null;

    for (const item of items) {
      const product = products.find(p => p.id === item.id);
      const quantity = Math.min(Math.max(Number(item.cantidad || 1), 1), 20);
      if (product) addProduct(cliente, product, quantity);
    }

    cliente.paso = "inicio";
    cliente.productoPendiente = null;
    cliente.pedidoOrigen = "tienda";
    await cliente.save();

    try {
      await sendText(cliente.numero, ticket(cliente, false));
      await sendButtons(cliente.numero, "Recibimos tu carrito de la tienda en línea. ¿Deseas confirmar tu pedido?", [
        { id: "confirm_order", title: "✅ Confirmar" },
        { id: "show_cart", title: "🛒 Ver carrito" },
        { id: "empty_cart", title: "🗑️ Vaciar" },
      ]);
    } catch (sendError) {
      console.error("Error enviando pedido de tienda a WhatsApp:", sendError.response?.data || sendError.message);
      return res.status(502).json({
        error: "El pedido se guardó, pero no se pudo enviar a WhatsApp. Revisa TOKEN, PHONE_NUMBER_ID o el número del cliente.",
        detalle: sendError.response?.data || sendError.message,
      });
    }

    res.json({
      ok: true,
      numero: cliente.numero,
      total: totalOf(cliente),
      pedidos: cliente.pedidos,
      mensaje: "Pedido enviado a WhatsApp. Revisa el chat para confirmar."
    });
  } catch (error) {
    next(error);
  }
});

function protectPanel(req, res, next) {
  if (!PANEL_API_KEY) return next();
  if (req.get("x-api-key") === PANEL_API_KEY) return next();
  return res.status(401).json({ error: "No autorizado" });
}

app.use("/api", protectPanel);

function serializeActive(cliente) {
  return {
    id: cliente._id,
    numero: cliente.numero,
    nombre: cliente.nombre || "Cliente",
    direccion: cliente.direccion,
    pedidos: cliente.pedidos,
    total: totalOf(cliente),
    estadoPedido: cliente.estadoPedido,
    paso: cliente.paso,
    horaConfirmacion: cliente.horaConfirmacion,
    ultimaActividad: cliente.ultimaActividad,
    pedidoOrigen: cliente.pedidoOrigen || "whatsapp",
    createdAt: cliente.createdAt,
    updatedAt: cliente.updatedAt,
  };
}

app.get("/api/pedidos", async (_req, res, next) => {
  try {
    const clientes = await Cliente
      .find({ estadoPedido: { $ne: "sin_pedido" } })
      .sort({ ultimaActividad: -1 });

    res.json(clientes.map(serializeActive));
  } catch (error) {
    next(error);
  }
});

app.get("/api/historial", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 1000);

    const clientes = await Cliente
      .find({ historialPedidos: { $exists: true, $ne: [] } })
      .sort({ updatedAt: -1 });

    const historial = clientes.flatMap(cliente =>
      cliente.historialPedidos.map(pedido => ({
        id: pedido._id,
        numero: pedido.numero || cliente.numero,
        nombre: pedido.nombre || cliente.nombre || "Cliente",
        fecha: pedido.fecha,
        estadoFinal: pedido.estadoFinal || "entregado",
        pedidos: pedido.pedidos || [],
        total: pedido.total || 0,
        direccion: pedido.direccion || cliente.direccion || null,
        motivoCancelacion: pedido.motivoCancelacion || "",
      }))
    )
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, limit);

    res.json(historial);
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const activos = await Cliente.find({ estadoPedido: { $ne: "sin_pedido" } });
    const conHistorial = await Cliente.find({ historialPedidos: { $exists: true, $ne: [] } });

    const historial = conHistorial.flatMap(c => c.historialPedidos || []);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const ventasHoy = historial
      .filter(p => p.estadoFinal === "entregado" && new Date(p.fecha) >= hoy)
      .reduce((sum, p) => sum + (p.total || 0), 0);

    res.json({
      activos: activos.length,
      confirmados: activos.filter(p => p.estadoPedido === "confirmado").length,
      cocina: activos.filter(p => p.estadoPedido === "cocina").length,
      camino: activos.filter(p => p.estadoPedido === "en_camino").length,
      ventasHoy,
      historial: historial.length,
    });
  } catch (error) {
    next(error);
  }
});

async function changeOrderState(req, res, next) {
  try {
    const messages = {
      cocina: "🍳 ¡Tu pedido está en cocina!",
      en_camino: "🚚 ¡Tu pedido ya va en camino! Gracias por tu preferencia.",
      entregado: "✅ ¡Pedido entregado! Gracias por tu preferencia.",
      cancelado: "❌ Tu pedido fue cancelado.",
    };

    const cliente = await Cliente.findOne({ numero: req.body.numero });

    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

    const action = req.params.action;

    if (!messages[action]) return res.status(400).json({ error: "Acción inválida" });

    if (action === "entregado" || action === "cancelado") {
      if (cliente.pedidos.length) {
        cliente.historialPedidos.push({
          fecha: new Date(),
          estadoFinal: action,
          pedidos: cliente.pedidos.map(item => ({
            productId: item.productId,
            nombre: item.nombre,
            precio: item.precio,
            cantidad: item.cantidad,
          })),
          total: totalOf(cliente),
          nombre: cliente.nombre,
          numero: cliente.numero,
          direccion: cliente.direccion,
          motivoCancelacion: req.body.motivo || "",
        });
      }

      cliente.pedidos = [];
      cliente.estadoPedido = "sin_pedido";
      cliente.paso = "inicio";
      cliente.productoPendiente = null;
      cliente.horaConfirmacion = null;
      cliente.ultimaActividad = new Date();
    } else {
      cliente.estadoPedido = action;
      cliente.ultimaActividad = new Date();
    }

    await cliente.save();

    try {
      await sendText(cliente.numero, messages[action]);
    } catch (sendError) {
      console.error("No se pudo enviar WhatsApp:", sendError.response?.data || sendError.message);
    }

    return res.json({ ok: true, cliente: serializeActive(cliente) });
  } catch (error) {
    next(error);
  }
}

app.post("/api/pedido/a-cocina", (req, _res, next) => {
  req.params.action = "cocina";
  next();
}, changeOrderState);

app.post("/api/pedido/en-camino", (req, _res, next) => {
  req.params.action = "en_camino";
  next();
}, changeOrderState);

app.post("/api/pedido/entregado", (req, _res, next) => {
  req.params.action = "entregado";
  next();
}, changeOrderState);

app.post("/api/pedido/cancelar", (req, _res, next) => {
  req.params.action = "cancelado";
  next();
}, changeOrderState);

app.post("/api/pedido/:action", changeOrderState);

/* =========================
   WEBHOOK META
========================= */


/* =========================
   ERRORES + START
========================= */

app.use((error, _req, res, _next) => {
  console.error(error.response?.data || error);
  res.status(500).json({ error: "Error interno", detalle: error.message });
});

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB conectado correctamente");

    app.listen(PORT, () => {
      console.log(`✅ Marisco Alegre PRO listo en el puerto ${PORT}`);
    });
  })
  .catch(error => {
    console.error("❌ No fue posible conectar con MongoDB:", error.message);
    process.exitCode = 1;
  });