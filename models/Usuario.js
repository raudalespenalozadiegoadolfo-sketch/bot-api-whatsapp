const mongoose = require("mongoose");

const usuarioSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    usuario: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    rol: {
      type: String,
      enum: [
        "administrador",
        "empleado",
      ],
      default: "administrador",
    },

    activo: {
      type: Boolean,
      default: true,
    },

    ultimoAcceso: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Usuario",
  usuarioSchema
);