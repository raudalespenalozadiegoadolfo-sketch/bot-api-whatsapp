const {
  extractInput,
} = require("../services/inputService");

const {
  findOrCreateCliente,
} = require("../services/clienteService");

const {
  normalize,
  isThanks,
} = require("../services/utilsService");

const {
  detectProducts,
} = require("../services/productMatcherService");

const {
  addProduct,
  totalOf,
  emptyOrder,
} = require("../services/carritoService");

const {
  ticket,
} = require("../services/ticketService");

const {
  confirmOrder,
  finalizeOrder,
} = require("../services/orderFlowService");

const {
  sendText,
  sendImage,
  sendButtons,
  sendList,
} = require("../services/whatsappService");

const env = require("../config/env");

/* =========================
   CONFIGURACIÓN
========================= */

function storeUrl(context) {
  const legacyUrl = env.STORE_URL || "http://localhost:10000/tienda";
  if (context?.tenant?.storefrontKey === "marisco-alegre") return legacyUrl;
  if (!context?.tenant?.storefrontKey) {
    throw new Error("El tenant no tiene storefrontKey configurado.");
  }
  const baseUrl = legacyUrl.replace(/\/tienda(?:\/[^/]+)?\/?$/, "");
  return `${baseUrl}/tienda/${context.tenant.storefrontKey}`;
}

function menuImageUrl() {
  const baseUrl =
    env.PUBLIC_URL ||
    (
      env.STORE_URL
        ? env.STORE_URL.replace(
            /\/tienda\/?$/,
            ""
          )
        : "https://bot-api-whatsapp.onrender.com"
    );

  return `${baseUrl.replace(/\/$/, "")}/menu.jpg`;
}

function hasActiveOrder(cliente) {
  return [
    "confirmado",
    "cocina",
    "en_camino",
  ].includes(cliente.estadoPedido);
}

/* =========================
   BOTONES DEL CARRITO
========================= */

function cartButtons() {
  return [
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
  ];
}

/* =========================
   BIENVENIDA
========================= */

async function welcome(
  numero,
  cliente,
  context
) {
  const restaurante =
    env.RESTAURANT_NAME ||
    "Marisco Alegre";

  const saludo = cliente.nombre
    ? `¡Hola, ${cliente.nombre}!`
    : "¡Hola!";

  try {
    await sendImage(
      numero,
      menuImageUrl(),
      `🦐 Menú de ${restaurante}`
    );
  } catch (error) {
    console.warn(
      "⚠️ No se pudo enviar la imagen del menú:",
      error.response?.data ||
        error.message
    );
  }

  await sendList(
    numero,
    restaurante,
    `${saludo} Bienvenido a ${restaurante}. ¿Qué deseas hacer?`,
    "Ver opciones",
    [
      {
        id: "show_menu",
        title: "🍽️ Ver menú",
        description:
          "Ordenar por WhatsApp",
      },
      {
        id: "store_link",
        title: "🌐 Tienda online",
        description:
          "Editar y confirmar pedido",
      },
      {
        id: "show_cart",
        title: "🛒 Mi carrito",
        description:
          "Revisar productos agregados",
      },
      {
        id: "order_status",
        title: "📦 Mi pedido",
        description:
          "Consultar estado",
      },
    ]
  );

  return sendText(
    numero,
    `🌐 En la tienda puedes cambiar productos y cantidades antes de confirmar:\n${storeUrl(context)}`
  );
}

/* =========================
   MENÚ POR WHATSAPP
========================= */

function showMenu(numero) {
  return sendButtons(
    numero,
    "Elige una sección:",
    [
      {
        id: "type_food",
        title: "🍴 Comida",
      },
      {
        id: "type_drink",
        title: "🥤 Bebidas",
      },
    ]
  );
}

async function showCategories(
  numero,
  type,
  catalog
) {
  const categories =
    await catalog.getCategories(type);

  const rows = categories.map(
    (category, index) => ({
      id: `category_${type}_${index}`,
      title: category,
      description:
        "Ver productos disponibles",
    })
  );

  return sendList(
    numero,
    type === "food"
      ? "Comida"
      : "Bebidas",
    "Selecciona una categoría",
    "Ver categorías",
    rows
  );
}

async function showProducts(
  numero,
  type,
  categoryIndex,
  catalog
) {
  const categories =
    await catalog.getCategories(type);

  const category =
    categories[categoryIndex];

  if (!category) {
    return showMenu(numero);
  }

  const rows =
    (await catalog.getProductsByCategory(
      type,
      category
    )).map(product => ({
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

async function handleIncoming(
  message,
  context
) {
  if (!context?.tenantId || !context?.catalog) {
    throw new Error("Se requiere contexto de tenant para procesar WhatsApp.");
  }
  const catalog = context.catalog;
  const numero = message.from;
  const input = extractInput(message);

  const cliente =
    await findOrCreateCliente(numero);

  const command =
    input.value || "";

  const text =
    normalize(command);

  /* =========================
     AGRADECIMIENTOS
  ========================= */

  if (
    input.kind === "text" &&
    isThanks(text)
  ) {
    return sendText(
      numero,
      "😊 Gracias por tu preferencia. Esperamos atenderte nuevamente."
    );
  }

  /* =========================
     UBICACIÓN
  ========================= */

  if (input.kind === "location") {
    if (
      cliente.paso !==
      "esperando_ubicacion"
    ) {
      return sendText(
        numero,
        "Recibí tu ubicación. Primero confirma tu pedido desde el carrito."
      );
    }

    cliente.direccion = {
      latitude:
        input.value.latitude,
      longitude:
        input.value.longitude,
    };

    return finalizeOrder(cliente);
  }

  /* =========================
     NOMBRE DEL CLIENTE
  ========================= */

  if (
    cliente.paso ===
      "esperando_nombre" &&
    input.kind === "text"
  ) {
    const nombre =
      String(input.value || "")
        .trim()
        .slice(0, 80);

    if (!nombre) {
      return sendText(
        numero,
        "Escribe el nombre para tu pedido."
      );
    }

    cliente.nombre = nombre;

    cliente.paso =
      cliente.direccion
        ? "confirmando_direccion"
        : "esperando_ubicacion";

    cliente.ultimaActividad =
      new Date();

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
      `Gracias, ${cliente.nombre}. Ahora compárteme tu ubicación usando el clip de WhatsApp.`
    );
  }

  /* =========================
     CANTIDAD DEL PRODUCTO
  ========================= */

  if (
    cliente.paso ===
      "esperando_cantidad" &&
    (
      input.kind === "text" ||
      input.kind === "button"
    )
  ) {
    if (hasActiveOrder(cliente)) {
      cliente.paso = "inicio";
      cliente.productoPendiente =
        null;

      await cliente.save();

      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se puede editar."
      );
    }

    const cantidad =
      command.startsWith(
        "quantity_"
      )
        ? parseInt(
            command.replace(
              "quantity_",
              ""
            ),
            10
          )
        : parseInt(text, 10);

    if (
      !Number.isInteger(cantidad) ||
      cantidad < 1 ||
      cantidad > 20
    ) {
      return sendText(
        numero,
        "Escribe una cantidad válida entre 1 y 20."
      );
    }

    const product =
      cliente.productoPendiente;

    if (!product) {
      cliente.paso = "inicio";
      cliente.productoPendiente =
        null;

      await cliente.save();

      return sendText(
        numero,
        "No encontré el producto pendiente. Vuelve a seleccionarlo del menú."
      );
    }

    addProduct(
      cliente,
      product,
      cantidad
    );

    cliente.productoPendiente =
      null;

    cliente.paso = "inicio";
    cliente.ultimaActividad =
      new Date();

    await cliente.save();

    return sendButtons(
      numero,
      `✅ Agregado: ${cantidad}x ${product.name}\n💰 Total: $${totalOf(cliente)}`,
      cartButtons()
    );
  }

  /* =========================
     DIRECCIÓN GUARDADA
  ========================= */

  if (command === "address_yes") {
    return finalizeOrder(cliente);
  }

  if (command === "address_no") {
    cliente.paso =
      "esperando_ubicacion";

    cliente.ultimaActividad =
      new Date();

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
    [
      "menu",
      "ver menu",
      "menú",
    ].includes(text)
  ) {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se puede editar. Puedes consultar su estado en “Mi pedido”."
      );
    }

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
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        `Tu pedido ya fue confirmado y no puede editarse.\n\nPuedes consultar su estado desde “Mi pedido”.`
      );
    }

    return sendText(
      numero,
      `🌐 Tienda online:\n${storeUrl(context)}\n\nAhí puedes agregar, quitar y cambiar cantidades antes de confirmar.`
    );
  }

  /* =========================
     CATEGORÍAS
  ========================= */

  if (command === "type_food") {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se pueden agregar más productos."
      );
    }

    return showCategories(
      numero,
      "food",
      catalog
    );
  }

  if (command === "type_drink") {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se pueden agregar más productos."
      );
    }

    return showCategories(
      numero,
      "drink",
      catalog
    );
  }

  if (
    command.startsWith(
      "category_"
    )
  ) {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se pueden agregar más productos."
      );
    }

    const [, type, index] =
      command.split("_");

    return showProducts(
      numero,
      type,
      Number(index),
      catalog
    );
  }

  /* =========================
     SELECCIÓN DE PRODUCTO
  ========================= */

  if (
    command.startsWith(
      "product_"
    )
  ) {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se puede editar."
      );
    }

    const productId =
      command.replace(
        "product_",
        ""
      );

    const product =
      await catalog.findProductById(productId);

    if (!product) {
      return showMenu(numero);
    }

    cliente.productoPendiente = {
      id: product.id,
      type: product.type,
      category: product.category,
      name: product.name,
      price: product.price,
      aliases:
        product.aliases || [],
    };

    cliente.paso =
      "esperando_cantidad";

    cliente.ultimaActividad =
      new Date();

    await cliente.save();

    return sendText(
      numero,
      `Seleccionaste: ${product.name}\nPrecio: $${product.price}\n\n¿Cuántos deseas?`
    );
  }

  /* =========================
     MOSTRAR CARRITO
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

    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        `${ticket(cliente, true)}\n\n🔒 El pedido ya está confirmado y no puede editarse.`
      );
    }

    return sendButtons(
      numero,
      `${ticket(cliente)}\n\nPara modificar productos o cantidades, utiliza la tienda online antes de confirmar:\n${storeUrl(context)}`,
      [
        {
          id: "confirm_order",
          title: "✅ Confirmar",
        },
        {
          id: "show_menu",
          title: "➕ Agregar más",
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
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya está confirmado."
      );
    }

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
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado. Solo puede cancelarse desde el panel del negocio."
      );
    }

    emptyOrder(cliente);

    cliente.paso = "inicio";
    cliente.productoPendiente =
      null;

    cliente.ultimaActividad =
      new Date();

    await cliente.save();

    return sendText(
      numero,
      "🗑️ Tu carrito quedó vacío."
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
      sin_pedido:
        "No tienes un pedido activo.",

      armando:
        "Tu pedido todavía no está confirmado.",

      confirmado:
        "✅ Tu pedido fue recibido. En breve pasará a cocina.",

      cocina:
        "🍳 Tu pedido está siendo preparado en cocina.",

      en_camino:
        "🚚 Tu pedido ya va en camino.",
    };

    return sendText(
      numero,
      estados[
        cliente.estadoPedido
      ] ||
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
    greetingWords.some(
      greeting =>
        text.includes(greeting)
    )
  ) {
    return welcome(numero, cliente, context);
  }

  /* =========================
     PEDIDOS ESCRITOS
  ========================= */

  if (input.kind === "text") {
    if (hasActiveOrder(cliente)) {
      return sendText(
        numero,
        "Tu pedido ya fue confirmado y no se puede editar."
      );
    }

    const detected =
      detectProducts(command, await catalog.getProducts());

    if (detected.length) {
      detected.forEach(
        ({
          product,
          quantity,
        }) => {
          addProduct(
            cliente,
            product,
            quantity
          );
        }
      );

      cliente.paso = "inicio";
      cliente.productoPendiente =
        null;

      cliente.ultimaActividad =
        new Date();

      await cliente.save();

      const resumen = detected
        .map(
          ({
            product,
            quantity,
          }) =>
            `• ${quantity}x ${product.name}`
        )
        .join("\n");

      return sendButtons(
        numero,
        `✅ Agregué a tu carrito:\n${resumen}\n\n💰 Total: $${totalOf(cliente)}`,
        cartButtons()
      );
    }
  }

  /* =========================
     RESPUESTA PREDETERMINADA
  ========================= */

  return welcome(numero, cliente, context);
}

module.exports = {
  handleIncoming,
  welcome,
  showMenu,
  showCategories,
  showProducts,
};
