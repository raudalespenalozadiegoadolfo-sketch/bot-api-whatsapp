const path = require("path");

const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const Combo = require("../models/Combo");

const {
  products: legacyProducts,
} = require("../services/menuService");

const {
  cleanPhone,
} = require("../services/utilsService");

const {
  addProduct,
  totalOf,
} = require("../services/carritoService");

const {
  ticket,
} = require("../services/ticketService");

const {
  sendText,
  sendButtons,
} = require("../services/whatsappService");

function showStore(_req, res) {
  return res.sendFile(
    path.join(
      __dirname,
      "..",
      "public",
      "tienda.html"
    )
  );
}

function serializeDatabaseProduct(product) {
  return {
    id: String(product._id),
    name: product.name,
    category: product.category,
    price: Number(product.price),
    type: product.type === "drink" ? "drink" : "food",
    description: product.description || "",
    imageUrl: product.imageUrl || "",
    aliases: Array.isArray(product.aliases) ? product.aliases : [],
    active: product.active !== false,
    source: "mongodb",
  };
}

function serializeLegacyProduct(product) {
  return {
    id: String(product.id),
    name: product.name,
    category: product.category,
    price: Number(product.price),
    type: product.type === "drink" ? "drink" : "food",
    description: product.description || "",
    imageUrl: product.imageUrl || "",
    aliases: Array.isArray(product.aliases) ? product.aliases : [],
    active: true,
    source: "legacy",
  };
}

function productKey(product) {
  return `${product.category}::${product.name}`
    .trim()
    .toLowerCase();
}

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function loadAvailableProducts() {
  const databaseProducts =
    await Producto.find({
      active: { $ne: false },
    })
      .sort({
        category: 1,
        order: 1,
        name: 1,
      })
      .lean();

  const productMap = new Map();

  legacyProducts
    .map(serializeLegacyProduct)
    .forEach(product => {
      productMap.set(
        productKey(product),
        product
      );
    });

  databaseProducts
    .map(serializeDatabaseProduct)
    .forEach(product => {
      productMap.set(
        productKey(product),
        product
      );
    });

  return Array.from(
    productMap.values()
  );
}

async function loadAvailableCombos(
  availableProducts
) {
  const combos =
    await Combo.find({
      active: { $ne: false },
    })
      .sort({
        order: 1,
        name: 1,
      })
      .populate({
        path: "items.productId",
        select:
          "name category price active imageUrl",
      })
      .lean();

  const productById =
    new Map(
      availableProducts.map(
        product => [
          String(product.id),
          product,
        ]
      )
    );

  const serialized = [];

  for (const combo of combos) {
    const resolvedItems = [];
    let valid = true;

    for (
      let itemIndex = 0;
      itemIndex < combo.items.length;
      itemIndex += 1
    ) {
      const item =
        combo.items[itemIndex];

      if (
        item.mode === "category"
      ) {
        const excluded =
          new Set(
            (
              item.excludedProductIds ||
              []
            ).map(id =>
              String(id)
            )
          );

        const options =
          availableProducts
            .filter(product =>
              normalizedText(
                product.category
              ) ===
                normalizedText(
                  item.category
                ) &&
              !excluded.has(
                String(product.id)
              )
            )
            .map(product => ({
              id:
                String(product.id),
              name:
                product.name,
              price:
                Number(
                  product.price
                ),
              category:
                product.category,
            }));

        if (!options.length) {
          valid = false;
          break;
        }

        resolvedItems.push({
          itemIndex,
          mode:
            "category",
          category:
            item.category,
          label:
            item.label ||
            `Elige ${item.category}`,
          cantidad:
            Number(
              item.cantidad || 1
            ),
          options,
        });

        continue;
      }

      const populated =
        item.productId &&
        typeof item.productId ===
          "object"
          ? item.productId
          : null;

      const productId =
        populated
          ? String(
              populated._id ||
              populated.id
            )
          : String(
              item.productId || ""
            );

      const product =
        productById.get(
          productId
        );

      if (!product) {
        valid = false;
        break;
      }

      resolvedItems.push({
        itemIndex,
        mode:
          "product",
        label:
          item.label ||
          product.name,
        cantidad:
          Number(
            item.cantidad || 1
          ),
        product: {
          id:
            String(product.id),
          name:
            product.name,
          price:
            Number(
              product.price
            ),
          category:
            product.category,
        },
      });
    }

    if (!valid) {
      continue;
    }

    serialized.push({
      id:
        String(combo._id),
      name:
        combo.name,
      category:
        "Combos",
      price:
        Number(
          combo.comboPrice
        ),
      normalPrice:
        Number(
          combo.normalPrice || 0
        ),
      type:
        "combo",
      description:
        combo.description || "",
      imageUrl:
        combo.imageUrl || "",
      active:
        combo.active !== false,
      items:
        resolvedItems,
    });
  }

  return serialized;
}

async function getMenu(
  _req,
  res,
  next
) {
  try {
    const products =
      await loadAvailableProducts();

    const combos =
      await loadAvailableCombos(
        products
      );

    const categories = [
      ...new Set(
        products
          .map(
            product =>
              product.category
          )
          .filter(Boolean)
      ),
    ];

    if (
      combos.length &&
      !categories.includes(
        "Combos"
      )
    ) {
      categories.unshift(
        "Combos"
      );
    }

    res.set({
      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    return res.json({
      ok: true,
      categories,
      products,
      combos,
    });
  } catch (error) {
    console.error(
      "❌ Error cargando menú:",
      error.stack ||
        error.message ||
        error
    );

    return next(error);
  }
}

function validateComboSelection(
  combo,
  selections = []
) {
  const selectionMap =
    new Map(
      (
        Array.isArray(selections)
          ? selections
          : []
      ).map(selection => [
        Number(
          selection.itemIndex
        ),
        Array.isArray(
          selection.productIds
        )
          ? selection.productIds.map(
              id => String(id)
            )
          : [],
      ])
    );

  const chosenSummary = [];

  for (const item of combo.items) {
    if (
      item.mode === "product"
    ) {
      chosenSummary.push(
        `${item.cantidad}x ${item.product.name}`
      );
      continue;
    }

    const selectedIds =
      selectionMap.get(
        Number(item.itemIndex)
      ) || [];

    if (
      selectedIds.length !==
      Number(item.cantidad)
    ) {
      throw new Error(
        `Debes completar "${item.label}".`
      );
    }

    const allowed =
      new Map(
        item.options.map(
          product => [
            String(product.id),
            product,
          ]
        )
      );

    const selectedNames = [];

    for (
      const selectedId
      of selectedIds
    ) {
      const product =
        allowed.get(
          String(selectedId)
        );

      if (!product) {
        throw new Error(
          `Una opción elegida para "${item.label}" ya no está disponible.`
        );
      }

      selectedNames.push(
        product.name
      );
    }

    const counts =
      new Map();

    selectedNames.forEach(
      name => {
        counts.set(
          name,
          (
            counts.get(name) || 0
          ) + 1
        );
      }
    );

    chosenSummary.push(
      Array.from(
        counts.entries()
      )
        .map(
          ([name, count]) =>
            `${count}x ${name}`
        )
        .join(", ")
    );
  }

  return chosenSummary;
}

async function createStoreOrder(
  req,
  res,
  next
) {
  try {
    const numero = cleanPhone(
      req.body.numero
    );

    const nombre = String(
      req.body.nombre || ""
    )
      .trim()
      .slice(0, 80);

    const items = Array.isArray(
      req.body.items
    )
      ? req.body.items
      : [];

    if (
      !/^\d{12,15}$/.test(
        numero
      )
    ) {
      return res.status(400).json({
        error:
          "Número inválido",
      });
    }

    if (!items.length) {
      return res.status(400).json({
        error:
          "El carrito está vacío",
      });
    }

    const cliente =
      await Cliente.findOneAndUpdate(
        { numero },
        {
          $setOnInsert: {
            numero,
          },
          $set: {
            ultimaActividad:
              new Date(),
            ...(nombre
              ? { nombre }
              : {}),
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

    const activeStates = [
      "confirmado",
      "cocina",
      "en_camino",
    ];

    if (
      activeStates.includes(
        cliente.estadoPedido
      )
    ) {
      return res.status(409).json({
        error:
          "Ya tienes un pedido activo. Debe entregarse o cancelarse antes de iniciar otro.",
      });
    }

    const availableProducts =
      await loadAvailableProducts();

    const availableCombos =
      await loadAvailableCombos(
        availableProducts
      );

    const productById =
      new Map(
        availableProducts.map(
          product => [
            String(product.id),
            product,
          ]
        )
      );

    const comboById =
      new Map(
        availableCombos.map(
          combo => [
            String(combo.id),
            combo,
          ]
        )
      );

    cliente.pedidos = [];
    cliente.estadoPedido =
      "sin_pedido";
    cliente.paso =
      "inicio";
    cliente.productoPendiente =
      null;

    for (const item of items) {
      const rawQuantity =
        Number(
          item.cantidad || 1
        );

      const quantity =
        Math.min(
          Math.max(
            Number.isFinite(
              rawQuantity
            )
              ? Math.trunc(
                  rawQuantity
                )
              : 1,
            1
          ),
          20
        );

      if (
        item.type === "combo"
      ) {
        const combo =
          comboById.get(
            String(
              item.comboId ||
              item.id
            )
          );

        if (!combo) {
          return res
            .status(400)
            .json({
              error:
                "Uno de los combos ya no está disponible.",
            });
        }

        let summary;

        try {
          summary =
            validateComboSelection(
              combo,
              item.selections
            );
        } catch (error) {
          return res
            .status(400)
            .json({
              error:
                error.message,
            });
        }

        const signature =
          JSON.stringify(
            item.selections || []
          )
            .replace(
              /[^a-zA-Z0-9]/g,
              ""
            )
            .slice(0, 80);

        const comboAsProduct = {
          id:
            `combo:${combo.id}:${signature}`,
          name:
            `${combo.name} (${summary.join("; ")})`,
          price:
            Number(
              combo.price
            ),
        };

        addProduct(
          cliente,
          comboAsProduct,
          quantity
        );

        continue;
      }

      const product =
        productById.get(
          String(item.id)
        );

      if (product) {
        addProduct(
          cliente,
          product,
          quantity
        );
      }
    }

    if (
      !cliente.pedidos.length
    ) {
      return res.status(400).json({
        error:
          "No se encontraron productos válidos en el pedido.",
      });
    }

    cliente.paso =
      "inicio";
    cliente.productoPendiente =
      null;
    cliente.pedidoOrigen =
      "tienda";
    cliente.ultimaActividad =
      new Date();

    await cliente.save();

    try {
      await sendText(
        cliente.numero,
        ticket(
          cliente,
          false
        )
      );

      await sendButtons(
        cliente.numero,
        "Recibimos tu carrito de la tienda en línea. ¿Deseas confirmar tu pedido?",
        [
          {
            id: "confirm_order",
            title: "✅ Confirmar",
          },
          {
            id: "show_cart",
            title: "🛒 Ver carrito",
          },
          {
            id: "empty_cart",
            title: "🗑️ Vaciar",
          },
        ]
      );
    } catch (sendError) {
      console.error(
        "❌ Error enviando pedido de tienda a WhatsApp:",
        sendError.response?.data ||
          sendError.message
      );

      return res.status(502).json({
        error:
          "El pedido se guardó, pero no se pudo enviar a WhatsApp.",
        detalle:
          sendError.response?.data ||
          sendError.message,
      });
    }

    return res.json({
      ok: true,
      numero:
        cliente.numero,
      total:
        totalOf(cliente),
      pedidos:
        cliente.pedidos,
      mensaje:
        "Pedido enviado a WhatsApp. Revisa el chat para confirmar.",
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  showStore,
  getMenu,
  createStoreOrder,
};
