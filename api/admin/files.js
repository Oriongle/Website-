const crypto = require("crypto");
const { requireAdmin } = require("../auth/session");
const { hasKvConfig } = require("../auth/user-store");

const FILES_KEY = "portal_files_v1";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function bad(res, message, code = 400) {
  return res.status(code).json({ error: message });
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

async function getFiles() {
  const raw = await kvGet(FILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f) => f && f.id && f.fileName && f.contentBase64);
  } catch {
    return [];
  }
}

async function saveFiles(files) {
  await kvSet(FILES_KEY, JSON.stringify(files));
}

function sanitize(value, max = 200) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

function toMeta(file) {
  return {
    id: file.id,
    title: file.title || file.fileName,
    fileName: file.fileName,
    mimeType: file.mimeType || "application/octet-stream",
    size: Number(file.size || 0),
    notes: file.notes || "",
    createdAt: file.createdAt || null,
    uploadedBy: file.uploadedBy || ""
  };
}

module.exports = async function handler(req, res) {
  if (!hasKvConfig()) {
    return bad(
      res,
      "File database is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.",
      500
    );
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  let files;
  try {
    files = await getFiles();
  } catch {
    return bad(res, "Unable to load files.", 500);
  }

  if (req.method === "GET") {
    const id = sanitize(req.query?.id || "", 80);
    if (!id) {
      return res.status(200).json({ ok: true, files: files.map(toMeta) });
    }

    const item = files.find((f) => f.id === id);
    if (!item) return bad(res, "File not found.", 404);

    const buffer = Buffer.from(String(item.contentBase64 || ""), "base64");
    const inline = String(req.query?.inline || "") === "1";
    const disposition = inline ? "inline" : "attachment";

    res.setHeader("Content-Type", item.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${item.fileName}"`);
    return res.status(200).send(buffer);
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const title = sanitize(body.title || "", 120);
    const fileName = sanitize(body.fileName || "", 180);
    const mimeType = sanitize(body.mimeType || "", 120) || "application/octet-stream";
    const notes = sanitize(body.notes || "", 500);
    const contentBase64 = String(body.contentBase64 || "").trim();

    if (!fileName) return bad(res, "File name is required.");
    if (!contentBase64) return bad(res, "File content is required.");

    let buffer;
    try {
      buffer = Buffer.from(contentBase64, "base64");
    } catch {
      return bad(res, "File content is invalid.");
    }

    if (!buffer || !buffer.length) return bad(res, "File content is invalid.");
    if (buffer.length > MAX_FILE_BYTES) {
      return bad(res, "File is too large. Max allowed size is 2 MB.");
    }

    files.unshift({
      id: crypto.randomUUID(),
      title: title || fileName,
      fileName,
      mimeType,
      size: buffer.length,
      notes,
      contentBase64,
      createdAt: new Date().toISOString(),
      uploadedBy: String(session.email || "")
    });

    await saveFiles(files);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = sanitize(req.body?.id || "", 80);
    if (!id) return bad(res, "File id is required.");
    const next = files.filter((f) => f.id !== id);
    if (next.length === files.length) return bad(res, "File not found.", 404);
    await saveFiles(next);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET,POST,DELETE");
  return bad(res, "Method not allowed", 405);
};
