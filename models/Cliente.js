const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema({
  productId: String,
  nombre: String,
  precio: Number,
  cantidad: { type: Number, default: 1 },
}, { _id: false });

const historialSchema = new mongoose.Schema({
  fecha: { type: Date, default: Date.now },
  estadoFinal: {
    type: String,
    enum: ["entregado", "cancelado"],
    default: "entregado",
  },
  pedidos: { type: [itemSchema], default: [] },
  total: { type: Number, default: 0 },
  nombre: String,
  numero: String,
  direccion: Object,
  motivoCancelacion: String,
}, { _id: true });

const clienteSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
  numero: { type: String, required: true, trim: true },
  nombre: { type: String, default: "" },
  direccion: { type: Object, default: null },
  pedidos: { type: [itemSchema], default: [] },
  historialPedidos: { type: [historialSchema], default: [] },
  productoPendiente: { type: Object, default: null },
  pedidoOrigen: { type: String, default: "whatsapp" },

  paso: {
  type: String,
  enum: [
    "inicio",
    "esperando_nombre",
    "esperando_ubicacion",
    "confirmando_direccion",
    "esperando_cantidad",
    "editando_carrito",
  ],
  default: "inicio",
},

  estadoPedido: {
    type: String,
    enum: ["sin_pedido", "armando", "confirmado", "cocina", "en_camino"],
    default: "sin_pedido",
  },

  horaConfirmacion: Date,
  ultimaActividad: Date,
}, { timestamps: true });

clienteSchema.index({ tenantId: 1, numero: 1 }, { unique: true });
clienteSchema.index({ tenantId: 1, estadoPedido: 1, ultimaActividad: -1 });

module.exports = mongoose.model("Cliente", clienteSchema);
