const express = require("express");
const router = express.Router();

const {
  showStore,
  getMenu,
  createStoreOrder,
} = require("../controllers/storeController");

router.get("/tienda", showStore);
router.get("/api/menu", getMenu);
router.post("/api/tienda/pedido", createStoreOrder);

module.exports = router;