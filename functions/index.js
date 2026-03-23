const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
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

async function requireCoreAdmin(req, res) {
  const authHeader = req.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const requesterEmail = String(decoded.email || "").trim().toLowerCase();
  if (!CORE_ADMINS.has(requesterEmail)) {
    res.status(403).json({ error: "Only protected core admins can perform this action." });
    return null;
  }
  return { requesterEmail };
}

async function deleteQueryDocs(querySnap) {
  if (querySnap.empty) return 0;
  let deleted = 0;
  let batch = db.batch();
  let ops = 0;
  for (const docSnap of querySnap.docs) {
    batch.delete(docSnap.ref);
    ops += 1;
    deleted += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return deleted;
}

exports.resendVerificationEmail = functions.region("us-central1").https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authz = await requireCoreAdmin(req, res);
    if (!authz) return;

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

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

exports.setMarketplaceTemporaryPassword = functions.region("us-central1").https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authz = await requireCoreAdmin(req, res);
    if (!authz) return;

    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const temporaryPassword = String(req.body?.temporaryPassword || "");

    if (!uid) return res.status(400).json({ error: "uid is required." });
    if (temporaryPassword.length < 8) return res.status(400).json({ error: "Temporary password must be at least 8 characters." });

    await admin.auth().updateUser(uid, { password: temporaryPassword });

    await db.collection("profiles").doc(uid).set({
      tempPasswordActive: true,
      mustChangePassword: true,
      tempPasswordSetAtMs: Date.now(),
      tempPasswordSetBy: authz.requesterEmail,
      email: email,
      updatedAt: Date.now()
    }, { merge: true });

    return res.status(200).json({
      ok: true,
      message: `Temporary password updated for ${email || uid}.`
    });
  } catch (error) {
    console.error("setMarketplaceTemporaryPassword failed", error);
    return res.status(500).json({ error: error.message || "Failed to set temporary password." });
  }
});

exports.deleteMarketplaceAccount = functions.region("us-central1").https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authz = await requireCoreAdmin(req, res);
    if (!authz) return;

    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!uid) return res.status(400).json({ error: "uid is required." });

    const listingsSnap = await db.collection("listings").where("uid", "==", uid).get();
    const eventSnap = await db.collection("eventResponses").where("uid", "==", uid).get();

    const listingsDeleted = await deleteQueryDocs(listingsSnap);
    const eventResponsesDeleted = await deleteQueryDocs(eventSnap);

    await db.collection("profiles").doc(uid).delete().catch(() => {});

    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }

    return res.status(200).json({
      ok: true,
      message: `Permanently deleted ${email || uid}.`,
      listingsDeleted,
      eventResponsesDeleted
    });
  } catch (error) {
    console.error("deleteMarketplaceAccount failed", error);
    return res.status(500).json({ error: error.message || "Failed to permanently delete account." });
  }
});
