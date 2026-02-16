const crypto = require("crypto");
const { requireAdmin } = require("../../lib/auth/session");
const { hasKvConfig } = require("../../lib/auth/user-store");

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
        userId: String(f.userId || ""),
        parentId: String(f.parentId || ""),
        allowedUserIds: Array.isArray(f.allowedUserIds)
          ? f.allowedUserIds.map((v) => String(v)).filter(Boolean)
          : [],
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
    userId: file.userId || "",
    createdAt: file.createdAt || null,
    uploadedBy: file.uploadedBy || ""
  };
}

function normalizeFolderId(folderId, folders) {
  const value = sanitize(folderId || "", 80);
  if (!value) return "";
  return folders.some((f) => f.id === value) ? value : "";
}

function normalizeUserId(userId) {
  return sanitize(userId || "", 80);
}

function normalizeParentId(parentId, folders) {
  const value = sanitize(parentId || "", 80);
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
      const userId = normalizeUserId(req.query?.userId || "");
      const scopedFolders = userId
        ? folders.filter((f) => String(f.userId || "") === userId)
        : folders.filter((f) => !f.userId);
      const folderMap = Object.fromEntries(folders.map((f) => [f.id, f.name]));
      let filteredFiles = userId
        ? files.filter((f) => String(f.userId || "") === userId)
        : files.filter((f) => !f.userId);
      if (folderId) {
        filteredFiles = filteredFiles.filter((f) => String(f.folderId || "") === folderId);
      }
      const metas = filteredFiles.map((f) => {
        const m = toMeta(f);
        return {
          ...m,
          folderName: m.folderId ? (folderMap[m.folderId] || "") : ""
        };
      });
      return res.status(200).json({ ok: true, files: metas, folders: scopedFolders });
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
    const userId = normalizeUserId(body.userId || "");
    const scopedFolders = userId
      ? folders.filter((f) => String(f.userId || "") === userId)
      : folders.filter((f) => !f.userId);

    if (type === "folder") {
      const name = sanitize(body.name || "", 80);
      if (!name) return bad(res, "Folder name is required.");
      const parentId = normalizeParentId(body.parentId, scopedFolders);
      const lower = name.toLowerCase();
      if (scopedFolders.some((f) => String(f.parentId || "") === parentId && String(f.name || "").toLowerCase() === lower)) {
        return bad(res, "A folder with this name already exists.");
      }
      folders.unshift({
        id: crypto.randomUUID(),
        name,
        userId,
        parentId,
        allowedUserIds: [],
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
    const folderId = normalizeFolderId(body.folderId, scopedFolders);

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
      userId,
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

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "allowedUserIds")) {
      const targetFolder = folders.find((f) => f.id === id);
      if (!targetFolder) return bad(res, "Folder not found.", 404);
      const list = Array.isArray(req.body?.allowedUserIds) ? req.body.allowedUserIds : [];
      targetFolder.allowedUserIds = Array.from(new Set(
        list.map((v) => sanitize(v, 80)).filter(Boolean)
      ));
      await saveFolders(folders);
      return res.status(200).json({ ok: true });
    }

    const file = files.find((f) => f.id === id);
    if (!file) return bad(res, "File not found.", 404);
    const userId = normalizeUserId(file.userId || req.body?.userId || "");
    const scopedFolders = userId
      ? folders.filter((f) => String(f.userId || "") === userId)
      : folders.filter((f) => !f.userId);

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "folderId")) {
      file.folderId = normalizeFolderId(req.body?.folderId, scopedFolders);
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
      const folder = folders.find((f) => f.id === folderId);
      const exists = Boolean(folder);
      if (!exists) return bad(res, "Folder not found.", 404);
      const folderUserId = String(folder.userId || "");
      const idsToDelete = new Set([folderId]);
      let changed = true;
      while (changed) {
        changed = false;
        folders.forEach((f) => {
          if (String(f.userId || "") !== folderUserId) return;
          if (idsToDelete.has(f.id)) return;
          if (idsToDelete.has(String(f.parentId || ""))) {
            idsToDelete.add(f.id);
            changed = true;
          }
        });
      }

      folders = folders.filter((f) => !idsToDelete.has(f.id));
      files.forEach((f) => {
        if (idsToDelete.has(String(f.folderId || "")) && String(f.userId || "") === folderUserId) {
          f.folderId = "";
        }
      });
      await Promise.all([saveFolders(folders), saveFiles(files)]);
      return res.status(200).json({ ok: true });
    }

    const id = sanitize(req.body?.id || "", 80);
    const userId = normalizeUserId(req.body?.userId || "");
    if (!id) return bad(res, "File id is required.");
    const file = files.find((f) => f.id === id);
    if (!file) return bad(res, "File not found.", 404);
    if (userId && String(file.userId || "") !== userId) {
      return bad(res, "File does not belong to this user.", 400);
    }
    const next = files.filter((f) => f.id !== id);
    await saveFiles(next);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET,POST,PATCH,DELETE");
  return bad(res, "Method not allowed", 405);
};
