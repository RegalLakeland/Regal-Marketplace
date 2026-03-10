const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGIN = 'https://regallakeland.github.io';
const MARKETPLACE_REDIRECT_URL = `${ALLOWED_ORIGIN}/Regal-Marketplace/index.html`;
const CORE_ADMINS = new Set([
  'michael.h@regallakeland.com',
  'janni.r@regallakeland.com'
]);

function applyCors(res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

async function requireCoreAdmin(req, res) {
  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({ error: 'Missing authorization token' });
    return null;
  }

  const decoded = await admin.auth().verifyIdToken(match[1]);
  const requesterEmail = String(decoded.email || '').trim().toLowerCase();

  if (!CORE_ADMINS.has(requesterEmail)) {
    res.status(403).json({ error: 'Only protected core admins can use this action.' });
    return null;
  }

  return {
    decoded,
    requesterEmail,
    requesterUid: String(decoded.uid || '').trim()
  };
}

function parseTargetEmail(userRecord, fallbackEmail) {
  return String(userRecord?.email || fallbackEmail || '').trim().toLowerCase();
}

exports.resendVerificationEmail = functions.region('us-central1').https.onRequest(async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authInfo = await requireCoreAdmin(req, res);
    if (!authInfo) return;

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const actionCodeSettings = {
      url: MARKETPLACE_REDIRECT_URL,
      handleCodeInApp: false
    };

    const verificationLink = await admin.auth().generateEmailVerificationLink(email, actionCodeSettings);

    return res.status(200).json({
      ok: true,
      email,
      verificationLink
    });
  } catch (error) {
    console.error('resendVerificationEmail failed', error);
    return res.status(500).json({ error: error.message || 'Failed to generate verification link.' });
  }
});

exports.deleteMarketplaceAccount = functions.region('us-central1').https.onRequest(async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authInfo = await requireCoreAdmin(req, res);
    if (!authInfo) return;

    const targetUid = String(req.body?.uid || '').trim();
    const fallbackEmail = String(req.body?.email || '').trim().toLowerCase();

    if (!targetUid) {
      return res.status(400).json({ error: 'Target uid is required.' });
    }

    let userRecord = null;
    try {
      userRecord = await admin.auth().getUser(targetUid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }

    const targetEmail = parseTargetEmail(userRecord, fallbackEmail);
    const targetIsProtected = CORE_ADMINS.has(targetEmail);
    const selfDelete = authInfo.requesterUid === targetUid;

    if (targetIsProtected && !selfDelete) {
      return res.status(403).json({
        error: 'Protected core admin accounts cannot be deleted by another admin.'
      });
    }

    const db = admin.firestore();
    const profileRef = db.collection('profiles').doc(targetUid);
    const listingsSnap = await db.collection('listings').where('uid', '==', targetUid).get();

    const batch = db.batch();
    batch.delete(profileRef);
    listingsSnap.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();

    if (userRecord) {
      await admin.auth().deleteUser(targetUid);
    }

    return res.status(200).json({
      ok: true,
      uid: targetUid,
      email: targetEmail,
      selfDelete,
      listingsDeleted: listingsSnap.size,
      message: selfDelete
        ? 'Your marketplace account was deleted.'
        : `${targetEmail || targetUid} was deleted successfully.`
    });
  } catch (error) {
    console.error('deleteMarketplaceAccount failed', error);
    return res.status(500).json({ error: error.message || 'Failed to delete account.' });
  }
});
