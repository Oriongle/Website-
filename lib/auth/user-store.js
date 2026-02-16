const crypto = require("crypto");

const USERS_KEY = "portal_users_v1";

function hasKvConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.STORAGE_REST_API_URL ||
    process.env.STORAGE_URL ||
    process.env.STORAGE_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN ||
    process.env.STORAGE_TOKEN ||
    process.env.STORAGE_REDIS_REST_TOKEN;
  return Boolean(url && token);
}

function getStoreConfig() {
  return {
    url:
      process.env.KV_REST_API_URL ||
      process.env.UPSTASH_REDIS_REST_URL ||
      process.env.STORAGE_REST_API_URL ||
      process.env.STORAGE_URL ||
      process.env.STORAGE_REDIS_REST_URL,
    token:
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.STORAGE_REST_API_TOKEN ||
      process.env.STORAGE_TOKEN ||
      process.env.STORAGE_REDIS_REST_TOKEN
  };
}

async function kvGet(key) {
  const cfg = getStoreConfig();
  const url = `${cfg.url}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` }
  });
  if (!res.ok) throw new Error("KV get failed");
  const json = await res.json();
  return json.result;
}

async function kvSet(key, value) {
  const cfg = getStoreConfig();
  const encoded = encodeURIComponent(value);
  const url = `${cfg.url}/set/${encodeURIComponent(key)}/${encoded}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}` }
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
