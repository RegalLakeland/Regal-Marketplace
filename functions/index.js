const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGIN = "https://regallakeland.github.io";
const CORE_ADMINS = new Set([
  "michael.h@regallakeland.com",
  "janni.r@regallakeland.com",
]);

function applyCors(res) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

exports.resendVerificationEmail = functions.region("us-central1").https.onRequest(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const requesterEmail = String(decoded.email || "").trim().toLowerCase();

    if (!CORE_ADMINS.has(requesterEmail)) {
      return res.status(403).json({ error: "Only protected core admins can generate verification links." });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const actionCodeSettings = {
      url: `${ALLOWED_ORIGIN}/Regal-Marketplace/index.html`,
      handleCodeInApp: false,
    };

    const verificationLink = await admin.auth().generateEmailVerificationLink(email, actionCodeSettings);

    return res.status(200).json({
      ok: true,
      email,
      verificationLink,
    });
  } catch (error) {
    console.error("resendVerificationEmail failed", error);
    return res.status(500).json({ error: error.message || "Failed to generate verification link." });
  }
});
