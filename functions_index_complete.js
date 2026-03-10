const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGIN = 'https://regallakeland.github.io';
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

function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE.'
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
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
    const authHeader = req.get('Authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const requesterEmail = String(decoded.email || '').trim().toLowerCase();

    if (!CORE_ADMINS.has(requesterEmail)) {
      return res.status(403).json({
        error: 'Only protected core admins can resend verification email.'
      });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const actionCodeSettings = {
      url: `${ALLOWED_ORIGIN}/Regal-Marketplace/index.html`,
      handleCodeInApp: false
    };

    const verificationLink = await admin.auth().generateEmailVerificationLink(
      email,
      actionCodeSettings
    );

    const transporter = getMailer();
    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
    const appName = process.env.APP_NAME || 'Regal Lakeland Marketplace';

    await transporter.sendMail({
      from: `${appName} <${fromEmail}>`,
      to: email,
      subject: `Verify your email for ${appName}`,
      text: [
        'Hello,',
        '',
        `Please verify your email address for ${appName} by clicking the link below:`,
        verificationLink,
        '',
        'If you did not request this, you can ignore this email.'
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <p>Hello,</p>
          <p>Please verify your email address for <strong>${appName}</strong> by clicking the button below.</p>
          <p><a href="${verificationLink}" style="display:inline-block;padding:12px 18px;background:#166534;color:#fff;text-decoration:none;border-radius:8px">Verify Email</a></p>
          <p>Or paste this link into your browser:</p>
          <p><a href="${verificationLink}">${verificationLink}</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>`
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('resendVerificationEmail failed', error);
    return res.status(500).json({
      error: error.message || 'Failed to resend verification email.'
    });
  }
});
