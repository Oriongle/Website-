function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function sanitize(value) {
  return String(value || "").replace(/[<>]/g, "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    name = "",
    email = "",
    requestType = "",
    app = "Not specified",
    message = "",
    company = ""
  } = req.body || {};

  if (company) {
    return res.status(200).json({ ok: true });
  }

  const cleanName = sanitize(name);
  const cleanEmail = sanitize(email);
  const cleanRequestType = sanitize(requestType);
  const cleanApp = sanitize(app);
  const cleanMessage = sanitize(message);

  if (!cleanName || cleanName.length < 2) {
    return badRequest(res, "Please enter your name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return badRequest(res, "Please enter a valid email.");
  }
  if (!cleanRequestType) {
    return badRequest(res, "Please select a request type.");
  }
  if (!cleanMessage || cleanMessage.length < 10) {
    return badRequest(res, "Please add a longer message.");
  }

  const resendKey =
    process.env.RESEND_API_KEY ||
    process.env.RESEND_KEY ||
    process.env.resend_api_key;
  if (!resendKey) {
    return res.status(500).json({
      error: "Server is not configured for email yet. Missing RESEND_API_KEY."
    });
  }

  const to = process.env.CONTACT_TO || "support@oriongle.co.uk";
  const from = process.env.CONTACT_FROM || "Orion GLE Website <onboarding@resend.dev>";
  const subject = `[Website] ${cleanRequestType} - ${cleanName}`;
  const text = [
    "New website contact request",
    "",
    `Name: ${cleanName}`,
    `Email: ${cleanEmail}`,
    `Request Type: ${cleanRequestType}`,
    `App: ${cleanApp || "Not specified"}`,
    "",
    "Message:",
    cleanMessage
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: cleanEmail,
        subject,
        text
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(502).json({ error: `Email provider error: ${error}` });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Unable to send message right now." });
  }
};
