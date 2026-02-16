const { verifyToken } = require("./_token");
const { getPortalSecret } = require("./config");

function getCookieValue(cookieHeader, key) {
  const raw = String(cookieHeader || "");
  const pairs = raw.split(";").map((v) => v.trim());
  const found = pairs.find((p) => p.startsWith(`${key}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = getPortalSecret();
  if (!secret) return res.status(500).json({ error: "Portal is not configured yet." });

  const token = getCookieValue(req.headers.cookie, "orion_portal_session");
  const payload = verifyToken(token, secret);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });

  return res.status(200).json({ ok: true, role: payload.role, email: payload.email });
};
