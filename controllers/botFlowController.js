const { alreadyProcessed } = require("../services/messageService");
const { extractInput } = require("../services/inputService");
const { findOrCreateCliente } = require("../services/clienteService");
const { normalize, isThanks } = require("../services/utilsService");
const { detectProducts } = require("../services/productMatcherService");
const { addProduct, totalOf, clearDraftOrder, emptyOrder } = require("../services/carritoService");
const { ticket } = require("../services/ticketService");
const { confirmOrder, finalizeOrder } = require("../services/orderFlowService");
const { sendText, sendButtons, sendList } = require("../services/whatsappService");
const { products, getCategories, getProductsByCategory, findProductById } = require("../services/menuService");
const env = require("../config/env");

function storeUrl() {
  return env.STORE_URL || "http://localhost:10000/tienda";
}

async function welcome(numero, cliente) {
  const saludo = cliente.nombre ? `¡Hola, ${cliente.nombre}!` : "¡Hola!";

  const limpio = clearDraftOrder(cliente);
  if (limpio) await cliente.save();

  await sendList(
    numero,
    env.RESTAURANT_NAME || "Marisco Alegre",
    `${saludo} Bienvenido a ${env.RESTAURANT_NAME || "Marisco Alegre"}. ¿Qué deseas hacer?`,
    "Ver opciones",
    [
      { id: "show_menu", title: "🍽️ Ver menú", description: "Ordenar por WhatsApp" },
      { id: "store_link", title: "🌐 Tienda online", description: "Abrir menú web con + y -" },
      { id: "show_cart", title: "🛒 Mi carrito", description: "Revisar productos agregados" },
      { id: "order_status", title: "📦 Mi pedido", description: "Consultar estado" },
    ]
  );

  return sendText(
    numero,
    `🌐 También puedes pedir directo en nuestra tienda online:\n${storeUrl()}`
  );
}

function showMenu(numero) {
  return sendButtons(numero, "Elige una sección:", [
    { id: "type_food", title: "🍴 Comida" },
    { id: "type_drink", title: "🥤 Bebidas" },
  ]);
}

function showCategories(numero, type) {
  const categories = getCategories(type);

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
  const categories = getCategories(type);
  const category = categories[categoryIndex];

  if (!category) return showMenu(numero);

  const rows = getProductsByCategory(type, category).map(p => ({
    id: `product_${p.id}`,
    title: p.name,
    description: `$${p.price}`,
  }));

  return sendList(numero, category, "Selecciona un producto", "Ver productos", rows);
}

async function handleIncoming(message) {
  const processed = await alreadyProcessed(message.id);
  if (processed) return;

  const numero = message.from;
  const input = extractInput(message);
  const cliente = await findOrCreateCliente(numero);

  const command = input.value;
  const text = normalize(command);

  if (input.kind === "text" && isThanks(text)) {
    return sendText(numero, "😊 Gracias por tu preferencia. Esperamos atenderte nuevamente.");
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

  if (command === "address_yes") return finalizeOrder(cliente);

  if (command === "address_no") {
    cliente.paso = "esperando_ubicacion";
    await cliente.save();
    return sendText(numero, "Compárteme la nueva ubicación.");
  }

  if (command === "show_menu" || ["menu", "ver menu", "menú"].includes(text)) {
    const limpio = clearDraftOrder(cliente);
    if (limpio) await cliente.save();
    return showMenu(numero);
  }

  if (command === "store_link" || text.includes("tienda") || text.includes("online")) {
    return sendText(
      numero,
      `🌐 Tienda online:\n${storeUrl()}\n\nCuando confirmes el carrito, el pedido llegará a este chat.`
    );
  }

  if (command === "type_food") return showCategories(numero, "food");
  if (command === "type_drink") return showCategories(numero, "drink");

  if (command.startsWith("category_")) {
    const [, type, index] = command.split("_");
    return showProducts(numero, type, Number(index));
  }

  if (command.startsWith("product_")) {
    if (["confirmado", "cocina", "en_camino"].includes(cliente.estadoPedido)) {
      return sendText(numero, "Ya tienes un pedido activo. Espera a que se entregue o cancélalo desde el panel.");
    }

    const product = findProductById(command.replace("product_", ""));
    if (!product) return showMenu(numero);

    addProduct(cliente, product, 1);
    await cliente.save();

    return sendButtons(numero, `✅ Agregado: ${product.name}\n💰 Total: $${totalOf(cliente)}`, [
      { id: "show_menu", title: "➕ Agregar más" },
      { id: "show_cart", title: "🛒 Ver carrito" },
      { id: "confirm_order", title: "✅ Confirmar" },
    ]);
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
    emptyOrder(cliente);
    await cliente.save();
    return sendText(numero, "Tu carrito quedó vacío.");
  }

  if (command === "order_status" || text.includes("mi pedido") || text.includes("cuanto tarda")) {
    const estados = {
      sin_pedido: "No tienes un pedido activo.",
      armando: "Tu pedido aún no está confirmado.",
      confirmado: "Tu pedido fue recibido. En breve pasará a cocina.",
      cocina: "Tu pedido está en cocina.",
      en_camino: "Tu pedido va en camino.",
    };

    return sendText(numero, estados[cliente.estadoPedido]);
  }

  if (["hola", "buenas", "hey", "inicio"].some(word => text.includes(word))) {
    return welcome(numero, cliente);
  }

  if (input.kind === "text") {
    const detected = detectProducts(command);

    if (detected.length) {
      if (["confirmado", "cocina", "en_camino"].includes(cliente.estadoPedido)) {
        return sendText(numero, "Ya tienes un pedido activo. Espera a que se entregue o cancélalo desde el panel.");
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

module.exports = {
  handleIncoming,
};