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

async function resolveTargetUser(targetUid, fallbackEmail) {
  const uid = String(targetUid || '').trim();
  const email = String(fallbackEmail || '').trim().toLowerCase();

  let userRecord = null;
  let resolvedUid = uid;

  if (uid) {
    try {
      userRecord = await admin.auth().getUser(uid);
      resolvedUid = userRecord.uid;
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
  }

  if (!userRecord && email) {
    try {
      userRecord = await admin.auth().getUserByEmail(email);
      resolvedUid = userRecord.uid;
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
  }

  return { userRecord, resolvedUid, resolvedEmail: parseTargetEmail(userRecord, email) };
}

async function requireAdminUser(req, res) {
  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({ error: 'Missing authorization token' });
    return null;
  }

  const decoded = await admin.auth().verifyIdToken(match[1]);
  const requesterEmail = String(decoded.email || '').trim().toLowerCase();
  const requesterUid = String(decoded.uid || '').trim();

  if (CORE_ADMINS.has(requesterEmail)) {
    return { decoded, requesterEmail, requesterUid };
  }

  const profileSnap = await admin.firestore().collection('profiles').doc(requesterUid).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;
  if (!profile || profile.isAdmin !== true || profile.banned === true) {
    res.status(403).json({ error: 'Only marketplace admins can use this action.' });
    return null;
  }

  return { decoded, requesterEmail, requesterUid, profile };
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

    const requestedUid = String(req.body?.uid || '').trim();
    const fallbackEmail = String(req.body?.email || '').trim().toLowerCase();

    if (!requestedUid && !fallbackEmail) {
      return res.status(400).json({ error: 'Target uid or email is required.' });
    }

    const { userRecord, resolvedUid, resolvedEmail } = await resolveTargetUser(requestedUid, fallbackEmail);
    const targetUid = resolvedUid || requestedUid;
    const targetEmail = resolvedEmail;
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

exports.setMarketplaceTemporaryPassword = functions.region('us-central1').https.onRequest(async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authInfo = await requireAdminUser(req, res);
    if (!authInfo) return;

    const requestedUid = String(req.body?.uid || '').trim();
    const fallbackEmail = String(req.body?.email || '').trim().toLowerCase();
    const temporaryPassword = String(req.body?.temporaryPassword || '');

    if (!requestedUid && !fallbackEmail) {
      return res.status(400).json({ error: 'Target uid or email is required.' });
    }

    if (temporaryPassword.length < 8) {
      return res.status(400).json({ error: 'Temporary password must be at least 8 characters.' });
    }

    const { userRecord, resolvedUid, resolvedEmail } = await resolveTargetUser(requestedUid, fallbackEmail);
    if (!userRecord || !resolvedUid) {
      return res.status(404).json({ error: 'No Firebase Authentication user was found for that account. Open Authentication > Users and confirm the email exists there.' });
    }

    const targetUid = resolvedUid;
    const targetEmail = resolvedEmail;
    const targetIsProtected = CORE_ADMINS.has(targetEmail);
    const selfReset = authInfo.requesterUid === targetUid;

    if (targetIsProtected && !selfReset) {
      return res.status(403).json({ error: 'Protected core admin accounts can only reset their own password.' });
    }

    await admin.auth().updateUser(targetUid, { password: temporaryPassword });

    const db = admin.firestore();
    const batch = db.batch();
    const stamp = Date.now();
    const profilePayload = {
      mustChangePassword: true,
      tempPasswordSetAtMs: stamp,
      tempPasswordSetBy: authInfo.requesterEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      authUid: targetUid
    };

    batch.set(db.collection('profiles').doc(targetUid), profilePayload, { merge: true });

    if (targetEmail) {
      const dupSnap = await db.collection('profiles').where('email', '==', targetEmail).get();
      dupSnap.forEach((docSnap) => {
        if (docSnap.id !== targetUid) {
          batch.set(docSnap.ref, {
            authUid: targetUid,
            tempPasswordSetAtMs: stamp,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      });
    }

    await batch.commit();

    return res.status(200).json({
      ok: true,
      uid: targetUid,
      email: targetEmail,
      selfReset,
      message: selfReset
        ? 'Your temporary password was saved. You will be forced to change it after login.'
        : `Temporary password saved for ${targetEmail || targetUid}.`,
      note: requestedUid && requestedUid !== targetUid
        ? 'The selected profile row did not match the live Auth user, so the reset was applied to the real Firebase Authentication account for this email.'
        : ''
    });
  } catch (error) {
    console.error('setMarketplaceTemporaryPassword failed', error);
    return res.status(500).json({ error: error.message || 'Failed to set temporary password.' });
  }
});
