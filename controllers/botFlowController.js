const { alreadyProcessed } = require("../services/messageService");
const { extractInput } = require("../services/inputService");
const { findOrCreateCliente } = require("../services/clienteService");
const { normalize, isThanks } = require("../services/utilsService");
const { detectProducts } = require("../services/productMatcherService");

const {
  addProduct,
  totalOf,
  emptyOrder,
} = require("../services/carritoService");

const { ticket } = require("../services/ticketService");

const {
  confirmOrder,
  finalizeOrder,
} = require("../services/orderFlowService");

const {
  sendText,
  sendButtons,
  sendList,
} = require("../services/whatsappService");

const {
  getCategories,
  getProductsByCategory,
  findProductById,
} = require("../services/menuService");

const {
  interpretCommand,
} = require("../services/commandInterpreterService");

const {
  executeCartCommand,
} = require("../services/intelligentCartService");

const env = require("../config/env");

/* =========================
   CONFIGURACIÓN
========================= */

function storeUrl() {
  return env.STORE_URL || "http://localhost:10000/tienda";
}

/* =========================
   MENÚ PRINCIPAL
========================= */

async function welcome(numero, cliente) {
  const saludo = cliente.nombre
    ? `¡Hola, ${cliente.nombre}!`
    : "¡Hola!";

  await sendList(
    numero,
    env.RESTAURANT_NAME || "Marisco Alegre",
    `${saludo} Bienvenido a ${
      env.RESTAURANT_NAME || "Marisco Alegre"
    }. ¿Qué deseas hacer?`,
    "Ver opciones",
    [
      {
        id: "show_menu",
        title: "🍽️ Ver menú",
        description: "Ordenar por WhatsApp",
      },
      {
        id: "store_link",
        title: "🌐 Tienda online",
        description: "Abrir menú web",
      },
      {
        id: "show_cart",
        title: "🛒 Mi carrito",
        description: "Revisar productos",
      },
      {
        id: "order_status",
        title: "📦 Mi pedido",
        description: "Consultar estado",
      },
    ]
  );

  return sendText(
    numero,
    `🌐 También puedes realizar tu pedido directamente aquí:\n${storeUrl()}`
  );
}

function showMenu(numero) {
  return sendButtons(numero, "Elige una sección:", [
    {
      id: "type_food",
      title: "🍴 Comida",
    },
    {
      id: "type_drink",
      title: "🥤 Bebidas",
    },
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

  if (!category) {
    return showMenu(numero);
  }

  const rows = getProductsByCategory(type, category).map(product => ({
    id: `product_${product.id}`,
    title: product.name,
    description: `$${product.price}`,
  }));

  return sendList(
    numero,
    category,
    "Selecciona un producto",
    "Ver productos",
    rows
  );
}

/* =========================
   FLUJO PRINCIPAL
========================= */

async function handleIncoming(message) {
  const processed = await alreadyProcessed(message.id);

  if (processed) {
    return;
  }

  const numero = message.from;
  const input = extractInput(message);
  const cliente = await findOrCreateCliente(numero);

  const command = input.value || "";
  const text = normalize(command);

  /* =========================
     AGRADECIMIENTOS
  ========================= */

  if (input.kind === "text" && isThanks(text)) {
    return sendText(
      numero,
      "😊 Gracias por tu preferencia. Esperamos atenderte nuevamente."
    );
  }

  if (input.kind === "text") {

    const commandResult = interpretCommand(command);

    const cartResult = executeCartCommand(
        cliente,
        commandResult
    );

    if (cartResult.handled) {

        if (!cartResult.ok) {
            return sendText(numero, cartResult.message);
        }

        await cliente.save();

        if (!cliente.pedidos.length) {
            return sendText(numero, cartResult.message);
        }

        return sendButtons(
            numero,
            `${cartResult.message}\n\n${cartResult.ticket}`,
            [
                {
                    id: "show_menu",
                    title: "➕ Agregar más",
                },
                {
                    id: "show_cart",
                    title: "🛒 Ver carrito",
                },
                {
                    id: "confirm_order",
                    title: "✅ Confirmar",
                },
            ]
        );
    }
  }
  
  /* =========================
     UBICACIÓN
  ========================= */

  if (input.kind === "location") {
    if (cliente.paso !== "esperando_ubicacion") {
      return sendText(
        numero,
        "Recibí tu ubicación. Confirma primero tu pedido desde el carrito."
      );
    }

    cliente.direccion = {
      latitude: input.value.latitude,
      longitude: input.value.longitude,
    };

    return finalizeOrder(cliente);
  }

  /* =========================
     NOMBRE DEL CLIENTE
  ========================= */

  if (
    cliente.paso === "esperando_nombre" &&
    input.kind === "text"
  ) {
    cliente.nombre = input.value.slice(0, 80);

    cliente.paso = cliente.direccion
      ? "confirmando_direccion"
      : "esperando_ubicacion";

    await cliente.save();

    if (cliente.direccion) {
      return sendButtons(
        numero,
        "¿Usamos tu ubicación anterior?",
        [
          {
            id: "address_yes",
            title: "Sí",
          },
          {
            id: "address_no",
            title: "No",
          },
        ]
      );
    }

    return sendText(
      numero,
      `Gracias, ${cliente.nombre}. Ahora compárteme tu ubicación.`
    );
  }

  /* =========================
     CANTIDAD DEL PRODUCTO
  ========================= */

  if (
    cliente.paso === "esperando_cantidad" &&
    (input.kind === "text" || input.kind === "button")
  ) {
    const cantidad = command.startsWith("quantity_")
      ? parseInt(command.replace("quantity_", ""), 10)
      : parseInt(text, 10);

    if (
      !Number.isInteger(cantidad) ||
      cantidad < 1 ||
      cantidad > 20
    ) {
      return sendText(
        numero,
        "Por favor escribe una cantidad válida entre 1 y 20. Ejemplo: 1, 2 o 3."
      );
    }

    const product = cliente.productoPendiente;

    if (!product) {
      cliente.paso = "inicio";
      cliente.productoPendiente = null;

      await cliente.save();

      return sendText(
        numero,
        "No encontré el producto pendiente. Vuelve a seleccionar un producto del menú."
      );
    }

    addProduct(cliente, product, cantidad);

    cliente.productoPendiente = null;
    cliente.paso = "inicio";

    await cliente.save();

    return sendButtons(
      numero,
      `✅ Agregado: ${cantidad}x ${product.name}\n💰 Total: $${totalOf(cliente)}`,
      [
        {
          id: "show_menu",
          title: "➕ Agregar más",
        },
        {
          id: "show_cart",
          title: "🛒 Ver carrito",
        },
        {
          id: "confirm_order",
          title: "✅ Confirmar",
        },
      ]
    );
  }

  /* =========================
     DIRECCIÓN GUARDADA
  ========================= */

  if (command === "address_yes") {
    return finalizeOrder(cliente);
  }

  if (command === "address_no") {
    cliente.paso = "esperando_ubicacion";

    await cliente.save();

    return sendText(
      numero,
      "Compárteme la nueva ubicación usando el clip de WhatsApp."
    );
  }

  /* =========================
     MOSTRAR MENÚ
  ========================= */

  if (
    command === "show_menu" ||
    ["menu", "ver menu", "menú"].includes(text)
  ) {
    return showMenu(numero);
  }

  /* =========================
     TIENDA EN LÍNEA
  ========================= */

  if (
    command === "store_link" ||
    text.includes("tienda") ||
    text.includes("online") ||
    text.includes("en linea")
  ) {
    return sendText(
      numero,
      `🌐 Tienda online:\n${storeUrl()}\n\nCuando confirmes el carrito, el pedido llegará a este chat para terminar el proceso.`
    );
  }

  /* =========================
     CATEGORÍAS
  ========================= */

  if (command === "type_food") {
    return showCategories(numero, "food");
  }

  if (command === "type_drink") {
    return showCategories(numero, "drink");
  }

  if (command.startsWith("category_")) {
    const [, type, index] = command.split("_");

    return showProducts(
      numero,
      type,
      Number(index)
    );
  }

  /* =========================
     SELECCIÓN DE PRODUCTO
  ========================= */

  if (command.startsWith("product_")) {
    if (
      ["confirmado", "cocina", "en_camino"].includes(
        cliente.estadoPedido
      )
    ) {
      return sendText(
        numero,
        "Ya tienes un pedido activo. Espera a que sea entregado o cancelado antes de iniciar otro."
      );
    }

    const productId = command.replace("product_", "");
    const product = findProductById(productId);

    if (!product) {
      return showMenu(numero);
    }

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

    return sendText(
      numero,
      `Seleccionaste: ${product.name}\nPrecio: $${product.price}\n\n¿Cuántos deseas?`
    );
  }

  /* =========================
     CARRITO
  ========================= */

  if (
    command === "show_cart" ||
    text.includes("carrito") ||
    text.includes("ticket")
  ) {
    if (!cliente.pedidos.length) {
      return sendText(
        numero,
        "Tu carrito está vacío."
      );
    }

    return sendButtons(
      numero,
      ticket(cliente),
      [
        {
          id: "confirm_order",
          title: "✅ Confirmar",
        },
        {
          id: "empty_cart",
          title: "🗑️ Vaciar",
        },
      ]
    );
  }

  /* =========================
     CONFIRMAR PEDIDO
  ========================= */

  if (
    command === "confirm_order" ||
    text === "confirmar" ||
    text.includes("finalizar")
  ) {
    return confirmOrder(cliente);
  }

  /* =========================
     VACIAR CARRITO
  ========================= */

  if (
    command === "empty_cart" ||
    text === "cancelar" ||
    text.includes("vaciar")
  ) {
    emptyOrder(cliente);

    await cliente.save();

    return sendText(
      numero,
      "Tu carrito quedó vacío."
    );
  }

  /* =========================
     ESTADO DEL PEDIDO
  ========================= */

  if (
    command === "order_status" ||
    text.includes("mi pedido") ||
    text.includes("va mi pedido") ||
    text.includes("cuanto tarda") ||
    text.includes("cuánto tarda")
  ) {
    const estados = {
      sin_pedido: "No tienes un pedido activo.",
      armando: "Tu pedido aún no está confirmado.",
      confirmado:
        "Tu pedido fue recibido. En breve pasará a cocina.",
      cocina:
        "🍳 Tu pedido está siendo preparado en cocina.",
      en_camino:
        "🚚 Tu pedido ya va en camino.",
    };

    return sendText(
      numero,
      estados[cliente.estadoPedido] ||
        "No pude identificar el estado de tu pedido."
    );
  }

  /* =========================
     SALUDOS
  ========================= */

  const greetingWords = [
    "hola",
    "buenas",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hey",
    "inicio",
  ];

  if (
    greetingWords.some(greeting =>
      text.includes(greeting)
    )
  ) {
    return welcome(numero, cliente);
  }

  /* =========================
     PEDIDOS ESCRITOS
  ========================= */

  if (input.kind === "text") {
    const detected = detectProducts(command);

    if (detected.length) {
      if (
        ["confirmado", "cocina", "en_camino"].includes(
          cliente.estadoPedido
        )
      ) {
        return sendText(
          numero,
          "Ya tienes un pedido activo. Espera a que sea entregado o cancelado antes de iniciar otro."
        );
      }

      detected.forEach(({ product, quantity }) => {
        addProduct(cliente, product, quantity);
      });

      await cliente.save();

      const resumen = detected
        .map(
          ({ product, quantity }) =>
            `• ${quantity}x ${product.name}`
        )
        .join("\n");

      return sendButtons(
        numero,
        `✅ Agregué a tu carrito:\n${resumen}\n\n💰 Total: $${totalOf(cliente)}`,
        [
          {
            id: "show_menu",
            title: "➕ Agregar más",
          },
          {
            id: "show_cart",
            title: "🛒 Ver carrito",
          },
          {
            id: "confirm_order",
            title: "✅ Confirmar",
          },
        ]
      );
    }
  }

  /* =========================
     RESPUESTA PREDETERMINADA
  ========================= */

  return welcome(numero, cliente);
}

module.exports = {
  handleIncoming,
  welcome,
  showMenu,
  showCategories,
  showProducts,
};