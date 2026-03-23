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

async function verifyCoreAdmin(req) {
  const authHeader = req.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new functions.https.HttpsError("unauthenticated", "Missing authorization token");
  }

  const decoded = await admin.auth().verifyIdToken(match[1]);
  const requesterEmail = String(decoded.email || "").trim().toLowerCase();

  if (!CORE_ADMINS.has(requesterEmail)) {
    throw new functions.https.HttpsError("permission-denied", "Only protected core admins can use this action.");
  }

  return decoded;
}

function onRequestWithCors(handler) {
  return functions.region("us-central1").https.onRequest(async (req, res) => {
    applyCors(res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      await handler(req, res);
    } catch (error) {
      const message = error?.message || "Request failed.";
      const code = error?.code === "permission-denied" ? 403 : error?.code === "unauthenticated" ? 401 : 500;
      console.error("Cloud Function error:", error);
      return res.status(code).json({ error: message });
    }
  });
}

exports.resendVerificationEmail = onRequestWithCors(async (req, res) => {
  await verifyCoreAdmin(req);

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
});

exports.setMarketplaceTemporaryPassword = onRequestWithCors(async (req, res) => {
  await verifyCoreAdmin(req);

  const uid = String(req.body?.uid || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const temporaryPassword = String(req.body?.temporaryPassword || "");

  if (!uid || !email || temporaryPassword.length < 8) {
    return res.status(400).json({ error: "uid, email, and a password of at least 8 characters are required." });
  }

  await admin.auth().updateUser(uid, { password: temporaryPassword });

  const profileRef = admin.firestore().collection("profiles").doc(uid);
  await profileRef.set({
    tempPasswordActive: true,
    mustChangePassword: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    passwordResetIssuedAtMs: Date.now(),
  }, { merge: true });

  return res.status(200).json({
    ok: true,
    uid,
    email,
    message: "Temporary password set."
  });
});

exports.deleteMarketplaceAccount = onRequestWithCors(async (req, res) => {
  await verifyCoreAdmin(req);

  const uid = String(req.body?.uid || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!uid) {
    return res.status(400).json({ error: "uid is required." });
  }

  const db = admin.firestore();

  // Delete listings created by this user
  const listingsSnap = await db.collection("listings").where("uid", "==", uid).get();
  const listingsBatch = db.batch();
  listingsSnap.docs.forEach((docSnap) => listingsBatch.delete(docSnap.ref));
  if (!listingsSnap.empty) {
    await listingsBatch.commit();
  }

  // Delete RSVP/event responses for this user
  const responsesSnap = await db.collection("eventResponses").where("uid", "==", uid).get();
  const responsesBatch = db.batch();
  responsesSnap.docs.forEach((docSnap) => responsesBatch.delete(docSnap.ref));
  if (!responsesSnap.empty) {
    await responsesBatch.commit();
  }

  // Delete profile
  await db.collection("profiles").doc(uid).delete().catch(() => {});

  // Delete auth user
  await admin.auth().deleteUser(uid);

  return res.status(200).json({
    ok: true,
    uid,
    email,
    deletedListings: listingsSnap.size,
    deletedResponses: responsesSnap.size,
    message: "Account permanently deleted."
  });
});
