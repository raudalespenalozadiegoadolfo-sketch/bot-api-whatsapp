const express =
  require("express");

const {
  login,
  currentUser,
  logout,
} = require(
  "../controllers/authController"
);

const {
  csrfToken,
  loginRateLimit,
} = require("../middleware/security");
const {
  requireTenantContext,
} = require("../middleware/tenantContext");

const router =
  express.Router();

router.post(
  "/login",
  loginRateLimit,
  login
);

router.get(
  "/csrf",
  csrfToken
);

router.get(
  "/me",
  requireTenantContext,
  currentUser
);

router.post(
  "/logout",
  logout
);

module.exports = router;
