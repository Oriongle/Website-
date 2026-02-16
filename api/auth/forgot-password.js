const crypto = require("crypto");
const { getUsers, saveUsers } = require("./user-store");

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildOrigin(req) {
  const fixed = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
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

  const { email = "", role = "" } = req.body || {};
  const cleanEmail = sanitizeEmail(email);
  const cleanRole = String(role || "").trim().toLowerCase();
  const ip = getClientIp(req);

  // Always return success-shaped response to avoid account enumeration.
  const generic = { ok: true, message: "If the account exists, a reset link has been sent." };

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(200).json(generic);
  }

  let store;
  try {
    store = await getUsers();
  } catch {
    return res.status(200).json(generic);
  }

  const users = store.users || [];
  const user = users.find((u) => {
    if (!u || u.active === false) return false;
    if (String(u.email || "").toLowerCase() !== cleanEmail) return false;
    if (!cleanRole) return true;
    return String(u.role || "").toLowerCase() === cleanRole;
  });

  if (!user) {
    return res.status(200).json(generic);
  }

  const resendKey =
    process.env.RESEND_API_KEY ||
    process.env.RESEND_KEY ||
    process.env.resend_api_key;
  if (!resendKey) {
    return res.status(200).json(generic);
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  user.resetTokenHash = tokenHash;
  user.resetTokenExpiresAt = expiresAt;

  appendAudit(user, {
    at: new Date().toISOString(),
    action: "requested",
    ip
  });

  try {
    await saveUsers(users);
  } catch {
    return res.status(200).json(generic);
  }

  const origin = buildOrigin(req);
  const url = `${origin || ""}/portal/reset-password.html?token=${encodeURIComponent(rawToken)}`;
  const to = cleanEmail;
  const from = process.env.RESET_FROM || process.env.CONTACT_FROM || "Orion GLE Website <onboarding@resend.dev>";
  const subject = "Reset your Orion GLE portal password";
  const text = [
    "We received a password reset request for your Orion GLE portal account.",
    "",
    "Use this secure link to set a new password:",
    url,
    "",
    "This link expires in 1 hour.",
    "If you did not request this, you can ignore this email."
  ].join("\n");

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text
      })
    });
  } catch {}

  return res.status(200).json(generic);
};
