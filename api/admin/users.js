const crypto = require("crypto");
const { requireAdmin } = require("../../lib/auth/session");
const { hashPassword } = require("../../lib/auth/password");
const { getUsers, saveUsers, newUserId, hasKvConfig } = require("../../lib/auth/user-store");
const FOLDERS_KEY = "portal_file_folders_v1";

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

function sanitizeFolderName(value) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 80);
}

async function ensureProjectFolderForClient(userId, projectName, byEmail) {
  const clean = sanitizeFolderName(projectName);
  if (!userId || !clean) return;
  const folders = await getFolders();
  const lower = clean.toLowerCase();
  let target = folders.find((f) =>
    !String(f.userId || "") &&
    !String(f.parentId || "") &&
    String(f.name || "").toLowerCase() === lower
  );
  if (!target) {
    target = {
      id: crypto.randomUUID(),
      name: clean,
      userId: "",
      parentId: "",
      allowedUserIds: [],
      createdAt: new Date().toISOString(),
      createdBy: String(byEmail || "")
    };
    folders.unshift(target);
  }
  const set = new Set(Array.isArray(target.allowedUserIds) ? target.allowedUserIds : []);
  set.add(String(userId));
  target.allowedUserIds = Array.from(set);
  await saveFolders(folders);
}

function bad(res, message, code = 400) {
  return res.status(code).json({ error: message });
}

function sanitizeUserForClient(u) {
  return {
    id: u.id,
    fullName: u.fullName || "",
    company: u.company || "",
    phone: u.phone || "",
    project: u.project || "",
    notes: u.notes || "",
    portalTitle: u.portalTitle || "",
    portalMessage: u.portalMessage || "",
    portalDownloads: Array.isArray(u.portalDownloads) ? u.portalDownloads : [],
    email: u.email,
    role: u.role,
    active: u.active !== false,
    createdAt: u.createdAt || null,
    lastLoginAt: u.lastLoginAt || null,
    lastPasswordResetAt: u.lastPasswordResetAt || null,
    inactivityResetRequiredAt: u.inactivityResetRequiredAt || null,
    source: u.source || "kv"
  };
}

function appendResetAudit(user, event) {
  const next = Array.isArray(user.resetAudit) ? user.resetAudit.slice(-49) : [];
  next.push(event);
  user.resetAudit = next;
}

function normalizePortalDownloads(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => ({
        label: String(item && item.label ? item.label : "").trim(),
        url: String(item && item.url ? item.url : "").trim(),
        note: String(item && item.note ? item.note : "").trim()
      }))
      .filter((item) => item.url);
  }

  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          label: String(parts[0] || "").trim(),
          url: String(parts[1] || "").trim(),
          note: String(parts[2] || "").trim()
        };
      })
      .filter((item) => item.url);
  }

  return [];
}

module.exports = async function handler(req, res) {
  if (!hasKvConfig()) {
    return bad(
      res,
      "User database is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.",
      500
    );
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  let store;
  try {
    store = await getUsers();
  } catch {
    return bad(res, "Unable to load users.", 500);
  }

  const users = store.users || [];

  if (req.method === "GET") {
    const envAdminEmail = String(process.env.ADMIN_PORTAL_EMAIL || process.env.OWNER_PORTAL_EMAIL || "").trim().toLowerCase();
    const merged = users.map(sanitizeUserForClient);
    if (envAdminEmail) {
      merged.unshift({
        id: "env-admin",
        email: envAdminEmail,
        role: "admin",
        active: true,
        createdAt: null,
        lastLoginAt: null,
        source: "env"
      });
    }
    return res.status(200).json({ ok: true, users: merged });
  }

  const body = req.body || {};

  if (req.method === "POST") {
    const fullName = String(body.fullName || "").trim();
    const company = String(body.company || "").trim();
    const phone = String(body.phone || "").trim();
    const project = String(body.project || "").trim();
    const notes = String(body.notes || "").trim();
    const portalTitle = String(body.portalTitle || "").trim();
    const portalMessage = String(body.portalMessage || "").trim();
    const portalDownloads = normalizePortalDownloads(body.portalDownloads);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "client").trim().toLowerCase();
    const active = body.active !== false;

    if (!email || !email.includes("@")) return bad(res, "Valid email is required.");
    if (password.length < 8) return bad(res, "Password must be at least 8 characters.");
    if (!["admin", "client"].includes(role)) return bad(res, "Role must be admin or client.");
    if (users.some((u) => u.email === email)) return bad(res, "A user with this email already exists.");

    const id = newUserId();
    if (role === "client" && project) {
      try {
        await ensureProjectFolderForClient(id, project, String(session.email || ""));
      } catch {
        return bad(res, "Unable to create project folder automatically.", 500);
      }
    }

    users.push({
      id,
      fullName,
      company,
      phone,
      project,
      notes,
      portalTitle,
      portalMessage,
      portalDownloads,
      email,
      role,
      passwordHash: hashPassword(password),
      active,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      source: "kv"
    });

    await saveUsers(users);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PATCH") {
    const id = String(body.id || "").trim();
    const fullName = Object.prototype.hasOwnProperty.call(body, "fullName")
      ? String(body.fullName || "").trim()
      : null;
    const company = Object.prototype.hasOwnProperty.call(body, "company")
      ? String(body.company || "").trim()
      : null;
    const phone = Object.prototype.hasOwnProperty.call(body, "phone")
      ? String(body.phone || "").trim()
      : null;
    const project = Object.prototype.hasOwnProperty.call(body, "project")
      ? String(body.project || "").trim()
      : null;
    const notes = Object.prototype.hasOwnProperty.call(body, "notes")
      ? String(body.notes || "").trim()
      : null;
    const portalTitle = Object.prototype.hasOwnProperty.call(body, "portalTitle")
      ? String(body.portalTitle || "").trim()
      : null;
    const portalMessage = Object.prototype.hasOwnProperty.call(body, "portalMessage")
      ? String(body.portalMessage || "").trim()
      : null;
    const portalDownloads = Object.prototype.hasOwnProperty.call(body, "portalDownloads")
      ? normalizePortalDownloads(body.portalDownloads)
      : null;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = body.role ? String(body.role).trim().toLowerCase() : "";
    const hasActive = typeof body.active === "boolean";

    const user = users.find((u) => u.id === id);
    if (!user) return bad(res, "User not found.", 404);

    if (email) {
      if (!email.includes("@")) return bad(res, "Valid email is required.");
      if (users.some((u) => u.email === email && u.id !== id)) return bad(res, "Email already in use.");
      user.email = email;
    }
    if (password) {
      if (password.length < 8) return bad(res, "Password must be at least 8 characters.");
      user.passwordHash = hashPassword(password);
      user.lastPasswordResetAt = new Date().toISOString();
      user.inactivityResetRequiredAt = "";
      appendResetAudit(user, {
        at: user.lastPasswordResetAt,
        action: "admin_reset",
        by: String(session.email || "")
      });
    }
    if (role) {
      if (!["admin", "client"].includes(role)) return bad(res, "Role must be admin or client.");
      user.role = role;
    }
    if (fullName !== null) user.fullName = fullName;
    if (company !== null) user.company = company;
    if (phone !== null) user.phone = phone;
    if (project !== null) user.project = project;
    if (notes !== null) user.notes = notes;
    if (portalTitle !== null) user.portalTitle = portalTitle;
    if (portalMessage !== null) user.portalMessage = portalMessage;
    if (portalDownloads !== null) user.portalDownloads = portalDownloads;
    if (hasActive) user.active = body.active;

    await saveUsers(users);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = String(body.id || "").trim();
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return bad(res, "User not found.", 404);
    users.splice(idx, 1);
    await saveUsers(users);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET,POST,PATCH,DELETE");
  return bad(res, "Method not allowed", 405);
};
