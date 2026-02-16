const { signToken } = require("./_token");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "Portal is not configured yet." });

  const { role = "", email = "", password = "" } = req.body || {};
  const cleanRole = String(role).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPassword = String(password);

  const ownerEmail = String(process.env.OWNER_PORTAL_EMAIL || "").trim().toLowerCase();
  const ownerPassword = String(process.env.OWNER_PORTAL_PASSWORD || "");
  const clientEmail = String(process.env.CLIENT_PORTAL_EMAIL || "").trim().toLowerCase();
  const clientPassword = String(process.env.CLIENT_PORTAL_PASSWORD || "");

  let ok = false;
  if (cleanRole === "owner") ok = cleanEmail === ownerEmail && cleanPassword === ownerPassword;
  if (cleanRole === "client") ok = cleanEmail === clientEmail && cleanPassword === clientPassword;

  if (!ok) return res.status(401).json({ error: "Invalid login details." });

  const token = signToken({ role: cleanRole, email: cleanEmail }, secret, "12h");
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `orion_portal_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; ${isProd ? "Secure;" : ""}`
  );

  return res.status(200).json({ ok: true, role: cleanRole });
};
