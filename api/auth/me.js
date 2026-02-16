const { verifyToken } = require("../../lib/auth/_token");
const { getPortalSecret } = require("../../lib/auth/config");
const { getUsers } = require("../../lib/auth/user-store");

function getCookieValue(cookieHeader, key) {
  const raw = String(cookieHeader || "");
  const pairs = raw.split(";").map((v) => v.trim());
  const found = pairs.find((p) => p.startsWith(`${key}=`));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = getPortalSecret();
  if (!secret) return res.status(500).json({ error: "Portal is not configured yet." });

  const token = getCookieValue(req.headers.cookie, "orion_portal_session");
  const payload = verifyToken(token, secret);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });

  let profile = null;
  if (payload.src === "kv" && payload.uid) {
    try {
      const store = await getUsers();
      const user = (store.users || []).find((u) => u.id === payload.uid && u.active !== false);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      profile = {
        id: user.id,
        fullName: user.fullName || "",
        company: user.company || "",
        phone: user.phone || "",
        project: user.project || "",
        notes: user.notes || "",
        portalTitle: user.portalTitle || "",
        portalMessage: user.portalMessage || "",
        portalDownloads: Array.isArray(user.portalDownloads) ? user.portalDownloads : []
      };
    } catch {
      profile = null;
    }
  }

  return res.status(200).json({
    ok: true,
    role: payload.role,
    email: payload.email,
    uid: payload.uid || "",
    src: payload.src || "",
    profile
  });
};
