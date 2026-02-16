const crypto = require("crypto");

function getPortalSecret() {
  const explicit =
    process.env.PORTAL_JWT_SECRET ||
    process.env.PORTAL_SECRET ||
    process.env.JWT_SECRET ||
    process.env.AUTH_SECRET;

  if (explicit) return String(explicit);

  const adminPass =
    process.env.ADMIN_PORTAL_PASSWORD || process.env.OWNER_PORTAL_PASSWORD || "";
  const clientPass = process.env.CLIENT_PORTAL_PASSWORD || "";

  // Last-resort deterministic fallback so login is not blocked by env name mismatches.
  if (adminPass || clientPass) {
    return crypto
      .createHash("sha256")
      .update(`orion-portal:${adminPass}:${clientPass}`)
      .digest("hex");
  }

  return "";
}

module.exports = { getPortalSecret };
