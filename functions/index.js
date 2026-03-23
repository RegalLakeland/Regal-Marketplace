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
  res.set("Vary", "Origin");
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
    res.status(403).json({ error: "Only protected core admins can use this action." });
    return null;
  }
  return { decoded, requesterEmail };
}

exports.resendVerificationEmail = functions.region("us-central1").https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = await requireCoreAdmin(req, res);
    if (!auth) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const actionCodeSettings = {
      url: `${ALLOWED_ORIGIN}/Regal-Marketplace/index.html`,
      handleCodeInApp: false,
    };

    const verificationLink = await admin.auth().generateEmailVerificationLink(email, actionCodeSettings);
    return res.status(200).json({ ok: true, email, verificationLink });
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
    const auth = await requireCoreAdmin(req, res);
    if (!auth) return;

    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const temporaryPassword = String(req.body?.temporaryPassword || "");

    if (!uid) return res.status(400).json({ error: "UID is required." });
    if (temporaryPassword.length < 8) return res.status(400).json({ error: "Temporary password must be at least 8 characters." });

    await admin.auth().updateUser(uid, { password: temporaryPassword });
    await admin.firestore().collection("profiles").doc(uid).set({
      mustChangePassword: true,
      tempPasswordActive: true,
      tempPasswordSetAtMs: Date.now(),
      tempPasswordSetBy: auth.requesterEmail,
      updatedAt: Date.now(),
    }, { merge: true });

    return res.status(200).json({ ok: true, uid, email, message: "Temporary password saved." });
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
    const auth = await requireCoreAdmin(req, res);
    if (!auth) return;

    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!uid) return res.status(400).json({ error: "UID is required." });

    if (CORE_ADMINS.has(email) && auth.requesterEmail !== email) {
      return res.status(403).json({ error: "Protected core admins can only delete their own account." });
    }

    const db = admin.firestore();

    const listingsSnap = await db.collection("listings").where("uid", "==", uid).get();
    const listingsBatch = db.batch();
    listingsSnap.forEach((docSnap) => listingsBatch.delete(docSnap.ref));
    if (!listingsSnap.empty) await listingsBatch.commit();

    const responseSnap = await db.collection("eventResponses").where("uid", "==", uid).get();
    const responseBatch = db.batch();
    responseSnap.forEach((docSnap) => responseBatch.delete(docSnap.ref));
    if (!responseSnap.empty) await responseBatch.commit();

    const exactProfileRef = db.collection("profiles").doc(uid);
    await exactProfileRef.delete().catch(() => {});

    if (email) {
      const dupProfiles = await db.collection("profiles").where("email", "==", email).get();
      const dupBatch = db.batch();
      dupProfiles.forEach((docSnap) => dupBatch.delete(docSnap.ref));
      if (!dupProfiles.empty) await dupBatch.commit();
    }

    await admin.auth().deleteUser(uid).catch(async (err) => {
      if (err?.code === 'auth/user-not-found') return;
      throw err;
    });

    return res.status(200).json({ ok: true, uid, email, message: "Account permanently deleted." });
  } catch (error) {
    console.error("deleteMarketplaceAccount failed", error);
    return res.status(500).json({ error: error.message || "Failed to delete account." });
  }
});
