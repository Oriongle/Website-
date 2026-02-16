const { requireAdmin } = require("../../lib/auth/session");
const { getUsers, hasKvConfig } = require("../../lib/auth/user-store");

function bad(res, message, code = 400) {
  return res.status(code).json({ error: message });
}

module.exports = async function handler(req, res) {
  if (!hasKvConfig()) {
    return bad(
      res,
      "User database is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.",
      500
    );
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return bad(res, "Method not allowed", 405);
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  let store;
  try {
    store = await getUsers();
  } catch {
    return bad(res, "Unable to load users.", 500);
  }

  const events = [];
  const users = store.users || [];
  users.forEach((user) => {
    const list = Array.isArray(user.resetAudit) ? user.resetAudit : [];
    list.forEach((event) => {
      events.push({
        at: event && event.at ? event.at : null,
        action: event && event.action ? event.action : "unknown",
        ip: event && event.ip ? String(event.ip) : "",
        by: event && event.by ? String(event.by) : "",
        days: event && event.days ? Number(event.days) : null,
        userId: user.id,
        name: user.fullName || "",
        email: user.email || "",
        role: user.role || ""
      });
    });
  });

  events.sort((a, b) => {
    const am = Date.parse(String(a.at || ""));
    const bm = Date.parse(String(b.at || ""));
    const av = Number.isNaN(am) ? 0 : am;
    const bv = Number.isNaN(bm) ? 0 : bm;
    return bv - av;
  });

  return res.status(200).json({ ok: true, events });
};
