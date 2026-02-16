const { verifyToken } = require("./_token");

function getCookieValue(cookieHeader, key) {
  const raw = String(cookieHeader || "");
  const pairs = raw.split(";").map((v) => v.trim());
  const found = pairs.find((p) => p.startsWith(`${key}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

function getSession(req) {
  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret) return null;
  const token = getCookieValue(req.headers.cookie, "orion_portal_session");
  if (!token) return null;
  return verifyToken(token, secret);
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return session;
}

module.exports = { getSession, requireAdmin };
