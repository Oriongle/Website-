const { signToken } = require("./_token");
const { getPortalSecret } = require("./config");
const { verifyPassword } = require("./password");
const { getUsers, saveUsers } = require("./user-store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = getPortalSecret();
  if (!secret) return res.status(500).json({ error: "Portal is not configured yet." });

  const { role = "", email = "", password = "" } = req.body || {};
  const cleanRole = String(role).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPassword = String(password);

  const adminEmail = String(
    process.env.ADMIN_PORTAL_EMAIL || process.env.OWNER_PORTAL_EMAIL || ""
  ).trim().toLowerCase();
  const adminPassword = String(
    process.env.ADMIN_PORTAL_PASSWORD || process.env.OWNER_PORTAL_PASSWORD || ""
  );

  const legacyClientEmail = String(process.env.CLIENT_PORTAL_EMAIL || "").trim().toLowerCase();
  const legacyClientPassword = String(process.env.CLIENT_PORTAL_PASSWORD || "");

  let signedIn = null;

  if ((cleanRole === "admin" || cleanRole === "owner") && cleanEmail === adminEmail && cleanPassword === adminPassword) {
    signedIn = { id: "env-admin", role: "admin", email: cleanEmail, source: "env" };
  }

  if (!signedIn && cleanRole === "client" && cleanEmail === legacyClientEmail && cleanPassword === legacyClientPassword) {
    signedIn = { id: "env-client", role: "client", email: cleanEmail, source: "env" };
  }

  let store = null;
  try {
    store = await getUsers();
  } catch {
    store = { enabled: false, users: [] };
  }

  if (!signedIn) {
    const user = (store.users || []).find((u) => u.email === cleanEmail && u.active !== false);
    if (user && user.role === cleanRole && verifyPassword(cleanPassword, user.passwordHash)) {
      signedIn = { id: user.id, role: user.role, email: user.email, source: "kv" };
      user.lastLoginAt = new Date().toISOString();
      if (store.enabled) {
        try { await saveUsers(store.users); } catch {}
      }
    }
  }

  if (!signedIn) return res.status(401).json({ error: "Invalid login details." });

  const token = signToken(
    {
      role: signedIn.role,
      email: signedIn.email,
      uid: signedIn.id,
      src: signedIn.source
    },
    secret,
    "12h"
  );

  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `orion_portal_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; ${isProd ? "Secure;" : ""}`
  );

  return res.status(200).json({ ok: true, role: signedIn.role });
};
