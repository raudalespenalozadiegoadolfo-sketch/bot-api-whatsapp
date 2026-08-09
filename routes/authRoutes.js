const express =
  require("express");

const {
  login,
  currentUser,
  logout,
} = require(
  "../controllers/authController"
);

const router =
  express.Router();

router.post(
  "/login",
  login
);

router.get(
  "/me",
  currentUser
);

router.post(
  "/logout",
  logout
);

module.exports = router;