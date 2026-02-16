const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function parseDuration(str) {
  const m = String(str || "12h").match(/^(\d+)([smhd])$/);
  if (!m) return 12 * 60 * 60;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 60 * 60;
  return n * 60 * 60 * 24;
}

function signToken(payload, secret, expiresIn = "12h") {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseDuration(expiresIn);
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: now, exp };
  const headerEncoded = base64url(JSON.stringify(header));
  const bodyEncoded = base64url(JSON.stringify(body));
  const data = `${headerEncoded}.${bodyEncoded}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${signature}`;
}

function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!parsed.exp || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken };
