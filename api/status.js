const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const dataPath = path.join(process.cwd(), "data", "status.json");
    const raw = fs.readFileSync(dataPath, "utf8");
    const json = JSON.parse(raw);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(json);
  } catch (error) {
    return res.status(500).json({ error: "Unable to load status data" });
  }
};
