const crypto = require("crypto");
const { hashPassword } = require("./password");
const { getUsers, saveUsers } = require("./user-store");

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function hashResetToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

function appendAudit(user, event) {
  const next = Array.isArray(user.resetAudit) ? user.resetAudit.slice(-49) : [];
  next.push(event);
  user.resetAudit = next;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token = "", password = "" } = req.body || {};
  const cleanToken = String(token || "").trim();
  const cleanPassword = String(password || "");
  const ip = getClientIp(req);

  if (!cleanToken) {
    return res.status(400).json({ error: "Reset token is required." });
  }
  if (cleanPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  let store;
  try {
    store = await getUsers();
  } catch {
    return res.status(500).json({ error: "Unable to load users." });
  }

  const users = store.users || [];
  const tokenHash = hashResetToken(cleanToken);
  const now = Date.now();
  const user = users.find((u) => {
    if (!u || u.active === false) return false;
    if (!u.resetTokenHash || !u.resetTokenExpiresAt) return false;
    if (String(u.resetTokenHash) !== tokenHash) return false;
    const expiry = Date.parse(String(u.resetTokenExpiresAt));
    if (!expiry || Number.isNaN(expiry)) return false;
    return expiry > now;
  });

  if (!user) {
    return res.status(400).json({ error: "Reset link is invalid or has expired." });
  }

  user.passwordHash = hashPassword(cleanPassword);
  user.resetTokenHash = "";
  user.resetTokenExpiresAt = "";
  user.inactivityResetRequiredAt = "";
  user.lastPasswordResetAt = new Date().toISOString();
  appendAudit(user, {
    at: user.lastPasswordResetAt,
    action: "completed",
    ip
  });

  try {
    await saveUsers(users);
  } catch {
    return res.status(500).json({ error: "Unable to save new password." });
  }

  return res.status(200).json({ ok: true });
};
