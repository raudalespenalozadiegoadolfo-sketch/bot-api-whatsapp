const axios = require("axios");
const env = require("../config/env");

/* =========================
   ENVIAR PETICIÓN A META
========================= */

async function sendPayload(to, payload) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: String(to),
        ...payload,
      },
      {
        headers: {
          Authorization: `Bearer ${env.TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      "❌ Error enviando mensaje por WhatsApp:",
      error.response?.data ||
        error.message ||
        error
    );

    throw error;
  }
}

/* =========================
   MENSAJE DE TEXTO
========================= */

async function sendText(to, body) {
  return sendPayload(to, {
    type: "text",
    text: {
      preview_url: true,
      body: String(body).slice(0, 4096),
    },
  });
}

/* =========================
   IMAGEN
========================= */

async function sendImage(
  to,
  imageUrl,
  caption = ""
) {
  if (!imageUrl) {
    throw new Error(
      "No se proporcionó la URL de la imagen."
    );
  }

  return sendPayload(to, {
    type: "image",
    image: {
      link: String(imageUrl),
      ...(caption
        ? {
            caption: String(caption).slice(
              0,
              1024
            ),
          }
        : {}),
    },
  });
}

/* =========================
   BOTONES
========================= */

async function sendButtons(
  to,
  body,
  buttons = []
) {
  const validButtons = buttons
    .filter(
      button =>
        button?.id &&
        button?.title
    )
    .slice(0, 3)
    .map(button => ({
      type: "reply",
      reply: {
        id: String(button.id).slice(
          0,
          256
        ),
        title: String(
          button.title
        ).slice(0, 20),
      },
    }));

  if (!validButtons.length) {
    return sendText(to, body);
  }

  return sendPayload(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: String(body).slice(
          0,
          1024
        ),
      },
      action: {
        buttons: validButtons,
      },
    },
  });
}

/* =========================
   LISTA INTERACTIVA
========================= */

async function sendList(
  to,
  header,
  body,
  buttonText,
  rows = []
) {
  const validRows = rows
    .filter(row => row?.id && row?.title)
    .slice(0, 10)
    .map(row => ({
      id: String(row.id).slice(
        0,
        200
      ),
      title: String(row.title).slice(
        0,
        24
      ),
      description: String(
        row.description || ""
      ).slice(0, 72),
    }));

  if (!validRows.length) {
    return sendText(to, body);
  }

  return sendPayload(to, {
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text: String(header).slice(
          0,
          60
        ),
      },
      body: {
        text: String(body).slice(
          0,
          1024
        ),
      },
      action: {
        button: String(
          buttonText
        ).slice(0, 20),
        sections: [
          {
            title: String(header).slice(
              0,
              24
            ),
            rows: validRows,
          },
        ],
      },
    },
  });
}

module.exports = {
  sendPayload,
  sendText,
  sendImage,
  sendButtons,
  sendList,
};