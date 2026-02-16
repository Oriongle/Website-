const crypto = require("crypto");
const { requireAdmin } = require("../auth/session");
const { hasKvConfig } = require("../auth/user-store");

const FILES_KEY = "portal_files_v1";
const FOLDERS_KEY = "portal_file_folders_v1";
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

async function getFolders() {
  const raw = await kvGet(FOLDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && f.id && f.name)
      .map((f) => ({
        id: String(f.id),
        name: String(f.name),
        createdAt: f.createdAt || null,
        createdBy: f.createdBy || ""
      }));
  } catch {
    return [];
  }
}

async function saveFolders(folders) {
  await kvSet(FOLDERS_KEY, JSON.stringify(folders));
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
    folderId: file.folderId || "",
    createdAt: file.createdAt || null,
    uploadedBy: file.uploadedBy || ""
  };
}

function normalizeFolderId(folderId, folders) {
  const value = sanitize(folderId || "", 80);
  if (!value) return "";
  return folders.some((f) => f.id === value) ? value : "";
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
  let folders;
  try {
    files = await getFiles();
    folders = await getFolders();
  } catch {
    return bad(res, "Unable to load file database.", 500);
  }

  if (req.method === "GET") {
    const id = sanitize(req.query?.id || "", 80);
    if (!id) {
      const folderId = sanitize(req.query?.folderId || "", 80);
      const folderMap = Object.fromEntries(folders.map((f) => [f.id, f.name]));
      const filteredFiles = folderId
        ? files.filter((f) => String(f.folderId || "") === folderId)
        : files;
      const metas = filteredFiles.map((f) => {
        const m = toMeta(f);
        return {
          ...m,
          folderName: m.folderId ? (folderMap[m.folderId] || "") : ""
        };
      });
      return res.status(200).json({ ok: true, files: metas, folders });
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
    const type = sanitize(body.type || "", 24).toLowerCase();

    if (type === "folder") {
      const name = sanitize(body.name || "", 80);
      if (!name) return bad(res, "Folder name is required.");
      const lower = name.toLowerCase();
      if (folders.some((f) => String(f.name || "").toLowerCase() === lower)) {
        return bad(res, "A folder with this name already exists.");
      }
      folders.unshift({
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        createdBy: String(session.email || "")
      });
      await saveFolders(folders);
      return res.status(200).json({ ok: true });
    }

    const title = sanitize(body.title || "", 120);
    const fileName = sanitize(body.fileName || "", 180);
    const mimeType = sanitize(body.mimeType || "", 120) || "application/octet-stream";
    const notes = sanitize(body.notes || "", 500);
    const contentBase64 = String(body.contentBase64 || "").trim();
    const folderId = normalizeFolderId(body.folderId, folders);

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
      folderId,
      contentBase64,
      createdAt: new Date().toISOString(),
      uploadedBy: String(session.email || "")
    });

    await saveFiles(files);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PATCH") {
    const id = sanitize(req.body?.id || "", 80);
    if (!id) return bad(res, "File id is required.");
    const file = files.find((f) => f.id === id);
    if (!file) return bad(res, "File not found.", 404);

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "folderId")) {
      file.folderId = normalizeFolderId(req.body?.folderId, folders);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      const nextTitle = sanitize(req.body?.title || "", 120);
      file.title = nextTitle || file.fileName;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) {
      file.notes = sanitize(req.body?.notes || "", 500);
    }

    await saveFiles(files);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const folderId = sanitize(req.body?.folderId || "", 80);
    if (folderId) {
      const exists = folders.some((f) => f.id === folderId);
      if (!exists) return bad(res, "Folder not found.", 404);
      folders = folders.filter((f) => f.id !== folderId);
      files.forEach((f) => {
        if (String(f.folderId || "") === folderId) f.folderId = "";
      });
      await Promise.all([saveFolders(folders), saveFiles(files)]);
      return res.status(200).json({ ok: true });
    }

    const id = sanitize(req.body?.id || "", 80);
    if (!id) return bad(res, "File id is required.");
    const next = files.filter((f) => f.id !== id);
    if (next.length === files.length) return bad(res, "File not found.", 404);
    await saveFiles(next);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET,POST,PATCH,DELETE");
  return bad(res, "Method not allowed", 405);
};
