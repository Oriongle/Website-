const { getSession } = require("../../lib/auth/session");
const { hasKvConfig, getUsers } = require("../../lib/auth/user-store");

const FILES_KEY = "portal_files_v1";
const FOLDERS_KEY = "portal_file_folders_v1";

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
        parentId: String(f.parentId || ""),
        userId: String(f.userId || ""),
        allowedUserIds: Array.isArray(f.allowedUserIds)
          ? f.allowedUserIds.map((v) => String(v)).filter(Boolean)
          : [],
        createdAt: f.createdAt || null
      }));
  } catch {
    return [];
  }
}

function sanitize(value, max = 200) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (!hasKvConfig()) {
    return bad(
      res,
      "File database is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.",
      500
    );
  }

  const session = getSession(req);
  if (!session || session.role !== "client" || !session.uid) {
    return bad(res, "Unauthorized", 401);
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return bad(res, "Method not allowed", 405);
  }

  let files;
  let folders;
  let store;
  try {
    files = await getFiles();
    folders = await getFolders();
    store = await getUsers();
  } catch {
    return bad(res, "Unable to load files.", 500);
  }

  const uid = String(session.uid);
  const id = sanitize(req.query?.id || "", 80);
  const user = (store.users || []).find((u) => String(u.id || "") === uid && u.active !== false);
  if (!user) return bad(res, "Unauthorized", 401);

  const privateFolders = folders.filter((f) => String(f.userId || "") === uid);
  const privateFiles = files.filter((f) => String(f.userId || "") === uid);

  const sharedFolders = folders.filter((f) => !f.userId);
  const sharedChildren = {};
  sharedFolders.forEach((f) => {
    const p = String(f.parentId || "");
    if (!sharedChildren[p]) sharedChildren[p] = [];
    sharedChildren[p].push(f);
  });

  const allowedSharedIds = new Set();
  function includeDescendants(folderId) {
    if (!folderId || allowedSharedIds.has(folderId)) return;
    allowedSharedIds.add(folderId);
    const kids = sharedChildren[folderId] || [];
    kids.forEach((child) => includeDescendants(child.id));
  }

  sharedFolders.forEach((folder) => {
    const allowed = Array.isArray(folder.allowedUserIds) ? folder.allowedUserIds : [];
    if (allowed.includes(uid)) includeDescendants(folder.id);
  });

  const visibleSharedFolders = sharedFolders.filter((f) => allowedSharedIds.has(f.id));
  const visibleSharedFiles = files.filter((f) => !f.userId && allowedSharedIds.has(String(f.folderId || "")));

  const scopedFolders = privateFolders.concat(visibleSharedFolders);
  const scopedFiles = privateFiles.concat(visibleSharedFiles);

  if (!id) {
    const folderMap = Object.fromEntries(scopedFolders.map((f) => [f.id, f.name]));
    const metas = scopedFiles.map((file) => ({
      id: file.id,
      title: file.title || file.fileName,
      fileName: file.fileName,
      mimeType: file.mimeType || "application/octet-stream",
      size: Number(file.size || 0),
      notes: file.notes || "",
      folderId: file.folderId || "",
      folderName: file.folderId ? (folderMap[file.folderId] || "") : "",
      createdAt: file.createdAt || null
    }));
    return res.status(200).json({ ok: true, files: metas, folders: scopedFolders });
  }

  const item = scopedFiles.find((f) => f.id === id);
  if (!item) return bad(res, "File not found.", 404);

  const buffer = Buffer.from(String(item.contentBase64 || ""), "base64");
  const inline = String(req.query?.inline || "") === "1";
  const disposition = inline ? "inline" : "attachment";

  res.setHeader("Content-Type", item.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader("Content-Disposition", `${disposition}; filename="${item.fileName}"`);
  return res.status(200).send(buffer);
};
