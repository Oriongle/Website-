const crypto = require("crypto");

const USERS_KEY = "portal_users_v1";

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  if (!res.ok) throw new Error("KV get failed");
  const json = await res.json();
  return json.result;
}

async function kvSet(key, value) {
  const encoded = encodeURIComponent(value);
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encoded}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  if (!res.ok) throw new Error("KV set failed");
}

function normalizeUsers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u) => u && u.id && u.email && u.role);
}

async function getUsers() {
  if (!hasKvConfig()) return { enabled: false, users: [] };
  const raw = await kvGet(USERS_KEY);
  if (!raw) return { enabled: true, users: [] };
  let parsed = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  return { enabled: true, users: normalizeUsers(parsed) };
}

async function saveUsers(users) {
  if (!hasKvConfig()) throw new Error("KV is not configured");
  await kvSet(USERS_KEY, JSON.stringify(users));
}

function newUserId() {
  return crypto.randomUUID();
}

module.exports = { getUsers, saveUsers, newUserId, hasKvConfig };
