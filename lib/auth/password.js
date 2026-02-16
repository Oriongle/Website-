const crypto = require("crypto");

function hashPassword(password) {
  const iter = 120000;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, iter, 32, "sha256").toString("hex");
  return `pbkdf2$${iter}$${salt}$${hash}`;
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyPassword(password, stored) {
  const value = String(stored || "");
  if (!value) return false;

  if (!value.startsWith("pbkdf2$")) {
    return safeEq(password, value);
  }

  const parts = value.split("$");
  if (parts.length !== 4) return false;
  const iter = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!iter || !salt || !expected) return false;

  const hash = crypto.pbkdf2Sync(password, salt, iter, 32, "sha256").toString("hex");
  return safeEq(hash, expected);
}

module.exports = { hashPassword, verifyPassword };
