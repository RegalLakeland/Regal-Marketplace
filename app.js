import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  signOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  collection,
  collectionGroup,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  increment,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const AUTH_FUNCTION_REGION = 'us-central1';

const MARKETPLACE_RULES_VERSION = '2026-03-24-v1';
const MARKETPLACE_RULES = [
  'Use this marketplace only if you are a current Regal Lakeland employee or an approved administrator of the site.',
  'Do not post anything illegal, stolen, counterfeit, unsafe, recalled, or prohibited by company policy or law.',
  'Do not use this site to harass, threaten, embarrass, defame, or target coworkers, managers, customers, vendors, or ownership.',
  'Keep all posts truthful. Misrepresenting an item, hiding damage, falsifying condition, or misleading coworkers is not allowed.',
  'Do not share customer data, repair orders, internal store information, pricing strategy, payroll details, passwords, or any confidential Regal information.',
  'No spam, mass solicitation, side-deal recruiting, outside business blasting, or repeated promotional posting without approval from site ownership.',
  'Photos, text, and listings must be workplace-appropriate. No obscene, hateful, discriminatory, retaliatory, or reputation-damaging content.',
  'Regal Lakeland and the website owner may remove posts, suspend access, preserve records, and report misuse at their sole discretion to protect the business.',
  'You are personally responsible for your own transactions, meetups, item safety, and communication. Regal Lakeland and the website owner are not liable for losses, disputes, or damage.',
  'Do not attempt to bypass admin approvals, impersonate another person, share accounts, manipulate listings, scrape data, or interfere with the operation of the site.',
  "Any post or conduct that could harm Regal's reputation, employee relations, store operations, family ownership interests, or the website owner's legal protection is grounds for removal.",
  'Using this marketplace means you agree to follow these rules every time you access it. Violations can result in deleted posts, revoked access, or further internal review.'
];

function verificationFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/resendVerificationEmail`;
}

async function callVerificationEmailFunction(user, email) {
  const token = await user.getIdToken(true);
  const res = await fetch(verificationFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Verification email request failed (${res.status})`);
  }
  return data;
}

const $ = (id) => document.getElementById(id);

function getVerifyActionCodeSettings() {
  const url = `${window.location.origin}${window.location.pathname}`;
  return {
    url,
    handleCodeInApp: false
  };
}

function applyAuthLanguage() {
  try {
    if (navigator?.language) {
      auth.languageCode = navigator.language;
    }
  } catch (_) {}
}

function normalizePersonName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}


const MODERATION_KEYWORDS = [
  { label: 'Insults / harassment', terms: ['idiot', 'moron', 'stupid', 'dumbass', 'clown', 'loser', 'delusional', 'pathetic', 'trash', 'garbage', 'need a life', 'shut up'] },
  { label: 'Profanity', terms: ['fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard'] },
  { label: 'Threat / self-harm', terms: ['kill yourself', 'kys', 'watch your back', 'i will find you', 'beat your ass'] },
  { label: 'Discriminatory / hateful', terms: ['racist', 'sexist', 'homophobic', 'nazi'] }
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeModerationSource(value) {
  return ` ${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function detectModerationIssues(value) {
  const source = normalizeModerationSource(value);
  const matchedLabels = [];
  const matchedTerms = [];

  MODERATION_KEYWORDS.forEach((rule) => {
    rule.terms.forEach((term) => {
      const pattern = new RegExp(`(^|\\s)${escapeRegex(term).replace(/\ /g, '\\s+')}($|\\s)`, 'i');
      if (pattern.test(source)) {
        matchedLabels.push(rule.label);
        matchedTerms.push(term);
      }
    });
  });

  const uniqueLabels = [...new Set(matchedLabels)];
  const uniqueTerms = [...new Set(matchedTerms)].slice(0, 12);
  return {
    flagged: uniqueLabels.length > 0,
    matchedLabels: uniqueLabels,
    matchedTerms: uniqueTerms,
    severity: uniqueLabels.includes('Threat / self-harm') ? 'HIGH' : (uniqueLabels.length ? 'REVIEW' : '')
  };
}

function buildModerationSnippet(value, max = 220) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…` : clean;
}

async function createModerationFlag(entry) {
  try {
    await addDoc(collection(db, 'moderationFlags'), {
      status: 'OPEN',
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      ...entry
    });
  } catch (err) {
    console.warn('Unable to create moderation flag', err);
  }
}

function setTempLoginContext(email, password) {
  try {
    sessionStorage.setItem('marketplace_temp_login_email', String(email || '').toLowerCase());
    sessionStorage.setItem('marketplace_temp_login_password', String(password || ''));
  } catch (_) {}
}

function getTempLoginPasswordForCurrentUser() {
  try {
    const storedEmail = sessionStorage.getItem('marketplace_temp_login_email') || '';
    const storedPassword = sessionStorage.getItem('marketplace_temp_login_password') || '';
    const activeEmail = String(currentUser?.email || '').toLowerCase();
    return storedEmail && activeEmail && storedEmail === activeEmail ? storedPassword : '';
  } catch (_) {
    return '';
  }
}

function clearTempLoginContext() {
  try {
    sessionStorage.removeItem('marketplace_temp_login_email');
    sessionStorage.removeItem('marketplace_temp_login_password');
  } catch (_) {}
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function approvalWaitingMessage() {
  return 'Your account is pending admin approval. Please allow up to 24 hours for review, although approval may happen sooner. Please check back shortly by logging in again.';
}

function approvalCreatedMessage() {
  return 'Your account request has been submitted to the marketplace admins for approval. Please allow up to 24 hours for review, although approval may happen sooner. Once approved, you should be able to log in normally.';
}

function loginBlockedMessage(profile) {
  const status = normalizeApprovalStatus(profile);
  if (status === 'DENIED') return 'Your marketplace access request has been denied. Please contact an admin.';
  if (status === 'DELETED') return 'This marketplace account is no longer active. Please contact an admin.';
  return approvalWaitingMessage();
}

function normalizeApprovalStatus(profile) {
  if (!profile) return 'PENDING_ADMIN_APPROVAL';
  if (profile.deleted) return 'DELETED';
  if (profile.accessManuallyDenied) return 'DENIED';
  if (profile.accessApproved === true) return 'APPROVED';
  const raw = String(profile.approvalStatus || '').trim().toUpperCase();
  if (raw === 'APPROVED' || raw === 'DENIED' || raw === 'DELETED') return raw;
  return 'PENDING_ADMIN_APPROVAL';
}

function isApprovalPending(profile) {
  return normalizeApprovalStatus(profile) === 'PENDING_ADMIN_APPROVAL';
}

function canCompleteMarketplaceLogin(profile) {
  return !!(
    profile &&
    profile.deleted !== true &&
    profile.banned !== true &&
    profile.accessApproved === true &&
    normalizeApprovalStatus(profile) === 'APPROVED'
  );
}

function setLoginFlashMessage(message) {
  try {
    if (message) sessionStorage.setItem('marketplace_login_flash', message);
    else sessionStorage.removeItem('marketplace_login_flash');
  } catch (_) {}
}

function consumeLoginFlashMessage() {
  try {
    const value = sessionStorage.getItem('marketplace_login_flash') || '';
    sessionStorage.removeItem('marketplace_login_flash');
    return value;
  } catch (_) {
    return '';
  }
}

function showLoginStatusMessage(message) {
  const normalized = String(message || '').trim();
  if (!normalized) return;
  if (lastStatusMessageShown === normalized) return;
  lastStatusMessageShown = normalized;
  if ($('verifyNote')) {
    $('verifyNote').textContent = normalized;
    $('verifyNote').style.display = 'block';
  }
  if ($('signupMsg')) {
    $('signupMsg').textContent = normalized;
    $('signupMsg').style.display = 'block';
  }
}

function clearLoginStatusMessage() {
  lastStatusMessageShown = '';
  if ($('verifyNote')) {
    $('verifyNote').textContent = '';
    $('verifyNote').style.display = 'none';
  }
  if ($('signupMsg')) {
    $('signupMsg').textContent = '';
    $('signupMsg').style.display = 'none';
  }
}

function buildPendingProfileData(user, fullName, elevated = false) {
  const now = Date.now();
  const cleanName = normalizePersonName(fullName || user.displayName || '');
  return {
    uid: user.uid,
    email: String(user.email || '').toLowerCase(),
    displayName: cleanName,
    pendingName: cleanName,
    requestedName: cleanName,
    isAdmin: elevated,
    isModerator: false,
    banned: false,
    deleted: false,
    manualVerified: elevated,
    emailVerified: !!user.emailVerified,
    accessApproved: elevated,
    accessManuallyDenied: false,
    approvalStatus: elevated ? 'APPROVED' : 'PENDING_ADMIN_APPROVAL',
    signupSource: 'self-service',
    signupSubmittedAtMs: now,
    pendingApprovalAtMs: elevated ? null : now,
    tempPasswordActive: false,
    mustChangePassword: false,
    rulesAccepted: false,
    rulesAcceptedVersion: '',
    rulesAcceptedName: '',
    rulesAcceptedFirstName: '',
    rulesAcceptedLastName: '',
    rulesAcceptedAt: null,
    rulesAcceptedAtMs: null,
    rulesAcceptedByUid: '',
    rulesAcceptedByEmail: '',
    rulesAcceptedDisplayNameSnapshot: '',
    createdAt: serverTimestamp(),
    createdAtMs: now,
    updatedAt: serverTimestamp()
  };
}

async function writeProfileWithRetry(uid, data, attempts = 4) {
  const ref = doc(db, 'profiles', uid);
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await setDoc(ref, data, { merge: true });
      const snap = await getDoc(ref);
      if (snap.exists()) return snap.data();
      lastErr = new Error('Profile write did not become visible yet.');
    } catch (err) {
      lastErr = err;
    }
    await delay(350 * (i + 1));
  }
  throw lastErr || new Error('Profile write failed.');
}

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const BOARD_DEFS = [
  { key: 'ALL', label: 'All Boards', desc: 'Everything in one place' },
  { key: 'FREE', label: 'Free Items', desc: 'Giveaways and quick pickups' },
  { key: 'BUYSELL', label: 'Buy / Sell', desc: 'Employee marketplace items' },
  { key: 'GARAGE', label: 'Garage Sales', desc: 'Neighborhood and moving sales' },
  { key: 'EVENTS', label: 'Events', desc: 'Meetups, cookouts, birthdays' },
  { key: 'PICTURES', label: 'Pictures', desc: 'Employee photography and dealership shots' },
  { key: 'WORK', label: 'Work News', desc: 'Dealership updates and notices' },
  { key: 'SERVICES', label: 'Local Services', desc: 'Side work and help needed' }
];

const FEATURED_EVENT = {
  id: 'regal-50th-anniversary-may-15-2026',
  title: 'Regal 50th Anniversary Party',
  subtitle: 'Dinner, drinks & live entertainment',
  dateLine: 'May 15th • 6:30 PM',
  locationLine: 'Haus 820 • 820 Massachusetts Ave, Lakeland, FL',
  imageUrl: 'Images/background5.jpg'
};

const RSVP_LABELS = {
  ATTENDING: 'Attending',
  MAYBE: 'Maybe',
  CANT: "Can't Attend"
};

let currentUser = null;
let currentProfile = null;
let listings = [];
let activeBoard = 'ALL';
let activeThread = null;
let activeThreadRepliesUnsub = null;
let activeThreadReplyDocs = [];
let participantRepliesUnsub = null;
let threadParticipationIds = new Set();
let threadReadState = {};
let threadUnreadCount = 0;
let listingsUnsub = null;
let profilesUnsub = null;
let userProfileUnsub = null;
let presenceTimer = null;
let profiles = [];
let eventResponses = [];
let eventResponsesUnsub = null;
let lastUnverifiedEmail = '';
let isSavingPost = false;
let editingPostId = null;
let lastStatusMessageShown = '';
let loginInFlight = false;
let signupInFlight = false;
let signupFlowContext = null;
let forcedAccessExitInFlight = false;
let lastActivityWriteAt = 0;
let lastActivityWriteKey = '';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;


function getClosedLabel(item) {
  const board = String(item?.board || item?.category || '').toUpperCase();
  if (board === 'EVENTS') return 'Ended';
  if (board === 'SERVICES' || board === 'WORK') return 'Completed';
  if (board === 'PICTURES') return 'Archived';
  return 'Sold';
}

function getMarkClosedLabel(item) {
  const board = String(item?.board || item?.category || '').toUpperCase();
  if (board === 'EVENTS') return 'Mark Ended';
  if (board === 'SERVICES' || board === 'WORK') return 'Mark Completed';
  if (board === 'PICTURES') return 'Archive Gallery';
  return 'Mark Sold';
}


window.addEventListener('error', (e) => {
  console.error('Marketplace JS error:', e.error || e.message || e);
});

document.addEventListener('DOMContentLoaded', () => {
  removeLegacyForgotPasswordUI();
  initPasswordToggles();
  bindStaticEvents();
  renderBoards();
  renderListings();

  const savedEmail = localStorage.getItem('regal_saved_email');
  if (savedEmail && $('loginEmail')) {
    $('loginEmail').value = savedEmail;
  }
  consumeLoginFlashMessage();

  onAuthStateChanged(auth, async (user) => {
  try {
    const isSignupFlowUser = !!(
      signupInFlight &&
      signupFlowContext &&
      user &&
      normalizeEmail(user.email) === normalizeEmail(signupFlowContext.email)
    );

    if (!user) {
      currentUser = null;
      currentProfile = null;
      clearTempLoginContext();
      stopListeners();
      threadReadState = {};
      threadUnreadCount = 0;
      updateAuthUI();
      return;
    }

    if (isSignupFlowUser) {
      return;
    }

    await user.reload().catch(() => {});
    currentUser = user;
    lastUnverifiedEmail = user.email || '';
    await ensureProfile(user);

    if (currentProfile?.banned) {
      alert('Your marketplace access has been disabled. Contact an admin.');
      await signOut(auth);
      return;
    }

    if (user.emailVerified && currentProfile && currentProfile.emailVerified !== true) {
      const authUpdates = {
        emailVerified: true,
        emailVerifiedAt: Date.now(),
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'profiles', user.uid), authUpdates).catch(() => {});
      currentProfile = { ...currentProfile, ...authUpdates };
    }

    if (!isProtectedCoreAdmin(user.email) && !canCompleteMarketplaceLogin(currentProfile)) {
      const blockedMessage = loginBlockedMessage(currentProfile);
      if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';
      if ($('loginPassword')) $('loginPassword').value = '';
      showPane('login');
      showLoginStatusMessage(blockedMessage);
      await signOut(auth);
      return;
    }

    lastUnverifiedEmail = '';
    clearLoginStatusMessage();
    if ($('verifyNote')) $('verifyNote').style.display = 'none';
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';

    loadThreadReadState();
    updateAuthUI();
    startListingsListener();
    startProfilesListener();
    startParticipantRepliesListener();
    startUserProfileGuard(user);
    startEventResponsesListener();
    void logMarketplaceActivity('Signed in to marketplace', {
      lastLoginAtMs: Date.now(),
      lastBoardVisited: activeBoard,
      currentView: activeBoard
    }, { force: true });
    touchPresence();
    if (!presenceTimer) presenceTimer = setInterval(touchPresence, PRESENCE_HEARTBEAT_MS);

    if (currentProfile?.mustChangePassword || currentProfile?.tempPasswordActive) {
      showPasswordGate();
      return;
    }

    hidePasswordGate();
    if (!hasRulesAcceptance(currentProfile)) {
      showRulesOverlay();
      return;
    }

    hideRulesOverlay();
    if (!currentProfile.displayName) {
      $('displayNameInput').value = user.email?.split('@')[0]?.replace(/[._]/g, ' ') || '';
      show('nameOverlay');
    }
  } catch (err) {
    console.error(err);
    alert(`auth_error — ${err?.message || err}`);
  }
  });
});



function initPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = targetId ? $(targetId) : null;
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      input.focus({ preventScroll: true });
      const end = input.value?.length || 0;
      try { input.setSelectionRange(end, end); } catch (_) {}
    });
  });
}

function removeLegacyForgotPasswordUI() {
  ['btnForgotPassword', 'forgotPasswordBtn', 'forgotPasswordLink', 'resetPasswordBtn', 'resetPasswordLink', 'forgotPasswordOverlay', 'resetPasswordOverlay'].forEach((id) => {
    const el = $(id);
    if (el) el.remove();
  });

  document.querySelectorAll('button, a').forEach((el) => {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text === 'forgot password?' || text === 'forgot password' || text === 'reset password') {
      el.remove();
    }
  });
}

function bindStaticEvents() {
  const loginForm = $('loginPane');
  const submitLoginForm = () => {
    if (loginInFlight) return;
    if (loginForm?.requestSubmit) {
      loginForm.requestSubmit();
      return;
    }
    handleLogin();
  };

  $('tabLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    const loginVisible = ($('loginPane')?.style.display || 'block') !== 'none';
    const emailVal = ($('loginEmail')?.value || '').trim();
    const passwordVal = ($('loginPassword')?.value || '').trim();
    if (!loginVisible) {
      showPane('login');
      setTimeout(() => (passwordVal ? $('loginPassword') : $('loginEmail'))?.focus(), 20);
      return;
    }
    if (emailVal && passwordVal) {
      submitLoginForm();
      return;
    }
    showPane('login');
    setTimeout(() => (emailVal ? $('loginPassword') : $('loginEmail'))?.focus(), 20);
  });

  $('tabSignup')?.addEventListener('click', (e) => {
    e.preventDefault();
    showPane('signup');
  });

  ['loginEmail', 'signupEmail'].forEach(id => {
    $(id)?.addEventListener('blur', (e) => {
      let val = e.target.value.trim().toLowerCase();
      if (val && !val.includes('@')) {
        e.target.value = val + '@regallakeland.com';
      }
    });
  });

  ['loginEmail', 'loginPassword'].forEach(id => {
    $(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitLoginForm();
      }
    });
  });

  loginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin();
  });

  $('btnLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitLoginForm();
  });
  $('btnSignup')?.addEventListener('click', handleSignup);
  $('btnResendVerify')?.addEventListener('click', handleResendVerification);
  $('btnSaveName')?.addEventListener('click', handleSaveName);
  $('btnCompletePasswordReset')?.addEventListener('click', handleForcePasswordChange);
  $('btnAgreeRules')?.addEventListener('click', handleRulesAgreement);
  $('rulesFullName')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleRulesAgreement(); } });
  $('rulesFirstName')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleRulesAgreement(); } });
  $('btnLogout')?.addEventListener('click', async () => {
    await signOut(auth);
  });
  $('threadAlertsBadge')?.addEventListener('click', scrollToFirstUnreadThread);
  $('heroThreadAlert')?.addEventListener('click', scrollToFirstUnreadThread);

  $('eventImageButton')?.addEventListener('click', () => show('eventImageOverlay'));
  $('eventImage')?.addEventListener('click', () => show('eventImageOverlay'));
  $('eventImageLarge')?.addEventListener('click', (e) => e.stopPropagation());
  $('eventImageOverlay')?.addEventListener('click', (e) => { if (e.target === $('eventImageOverlay')) hide('eventImageOverlay'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('eventImageOverlay')?.style.display === 'flex') hide('eventImageOverlay'); });

  const openPost = () => {
  if (!currentUser) {
    alert('Please log in first.');
    return;
  }
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before using the marketplace.');
    return;
  }
  resetPostEditor();
  show('postOverlay');
};

  $('btnNew')?.addEventListener('click', openPost);
  $('heroPostBtn')?.addEventListener('click', openPost);
  $('heroFreeBtn')?.addEventListener('click', () => {
    activeBoard = 'FREE';
    renderBoards();
    renderListings();
  });

  $('btnSavePost')?.addEventListener('click', handleSavePost);
  $('btnSendReply')?.addEventListener('click', handleSendReply);

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => { const target = btn.dataset.close; if (target === 'postOverlay') resetPostEditor(); hide(target); });
  });

  document.querySelectorAll('.overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && ['postOverlay', 'threadOverlay'].includes(overlay.id)) {
        if (overlay.id === 'postOverlay') resetPostEditor();
        hide(overlay.id);
      }
    });
  });

  $('q')?.addEventListener('input', renderListings);
  $('st')?.addEventListener('change', renderListings);
  $('sort')?.addEventListener('change', renderListings);

  document.body.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (!id) return;

    if (action === 'openThread') {
      await openThread(id);
    } else if (action === 'markSold') {
      await handleMarkSold(id);
    } else if (action === 'requestActive') {
      await handleRequestActive(id);
    } else if (action === 'editPost') {
      openPostEditor(id);
    } else if (action === 'deletePost' && canModerate()) {
      await hardDeleteListingFromFeed(id);
    } else if (action === 'deleteReply' && canModerate()) {
      const reply = mergedRepliesForThread(activeThread).find((entry) => entry.sourceKey === actionEl.dataset.replyKey);
      if (!reply) return;
      if (!confirm('Permanently delete this reply from the website?')) return;
      await hardDeleteReplyRecord(reply);
    } else if (action === 'markThreadRead') {
      markThreadSeen(id, Date.now());
    }
  });
}

function showPane(which) {
  clearLoginStatusMessage();
  const loginPane = $('loginPane');
  const signupPane = $('signupPane');
  const tabLogin = $('tabLogin');
  const tabSignup = $('tabSignup');
  if (!loginPane || !signupPane || !tabLogin || !tabSignup) return;

  if (which === 'login') {
    loginPane.style.display = 'block';
    signupPane.style.display = 'none';
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
  } else {
    loginPane.style.display = 'none';
    signupPane.style.display = 'block';
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
  }
}

function show(id) {
  const el = $(id);
  if (el) el.style.display = 'flex';
  if (id !== 'loginOverlay') document.body.classList.add('modal-open');
}

function hide(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
  if (id === 'threadOverlay') {
    stopActiveThreadRepliesListener();
    activeThread = null;
  }
  const stillOpen = ['nameOverlay', 'postOverlay', 'threadOverlay', 'passwordGateOverlay', 'rulesOverlay', 'eventImageOverlay'].some((overlayId) => {
    const o = $(overlayId);
    return o && (o.style.display === 'flex' || o.style.display === 'block');
  });
  if (!stillOpen) document.body.classList.remove('modal-open');
}

function isAllowedEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith('@regallakeland.com');
}

const PROTECTED_CORE_ADMINS = new Set([
  'michael.h@regallakeland.com',
  'janni.r@regallakeland.com'
]);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAdmin(email) {
  return ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(normalizeEmail(email));
}

function isProtectedCoreAdmin(email) {
  return PROTECTED_CORE_ADMINS.has(normalizeEmail(email));
}

function isViewerAdmin() {
  return !!currentProfile?.isAdmin || isProtectedCoreAdmin(currentUser?.email);
}


function canModerate() {
  return !!currentProfile && (!!currentProfile.isAdmin || !!currentProfile.isModerator || isProtectedCoreAdmin(currentUser?.email));
}

function threadReadStorageKey() {
  return `marketplace_thread_reads_v2:${currentUser?.uid || 'guest'}`;
}

function loadThreadReadState() {
  threadReadState = {};
  if (!currentUser?.uid) return;
  try {
    const raw = localStorage.getItem(threadReadStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      threadReadState = parsed;
    }
  } catch (_) {
    threadReadState = {};
  }
}

function persistThreadReadState() {
  if (!currentUser?.uid) return;
  try {
    localStorage.setItem(threadReadStorageKey(), JSON.stringify(threadReadState || {}));
  } catch (_) {}
}

function getThreadSeenAt(listingId) {
  return Number(threadReadState?.[listingId] || 0);
}

function markThreadSeen(listingId, seenAtMs = Date.now()) {
  if (!currentUser?.uid || !listingId) return;
  const normalized = Math.max(getThreadSeenAt(listingId), Number(seenAtMs || Date.now()));
  threadReadState = { ...(threadReadState || {}), [listingId]: normalized };
  persistThreadReadState();
  updateThreadNotificationUI();
}

function getListingLatestReplyMeta(item) {
  let latestMs = Number(item?.lastReplyAtMs || 0);
  let latestByUid = item?.lastReplyByUid || '';
  let latestByEmail = normalizeEmail(item?.lastReplyByEmail || '');
  const legacyReplies = Array.isArray(item?.replies) ? item.replies : [];
  legacyReplies.forEach((reply) => {
    if (reply?.deleted === true || reply?.hidden === true) return;
    const replyMs = Number(reply?.createdAtMs || reply?.createdAt || 0);
    if (replyMs >= latestMs) {
      latestMs = replyMs;
      latestByUid = reply?.uid || latestByUid || '';
      latestByEmail = normalizeEmail(reply?.userEmail || latestByEmail || '');
    }
  });
  if (activeThread?.id === item?.id) {
    activeThreadReplyDocs.forEach((reply) => {
      if (reply?.deleted === true || reply?.hidden === true) return;
      const replyMs = Number(reply?.createdAtMs || reply?.createdAt || 0);
      if (replyMs >= latestMs) {
        latestMs = replyMs;
        latestByUid = reply?.uid || latestByUid || '';
        latestByEmail = normalizeEmail(reply?.userEmail || latestByEmail || '');
      }
    });
  }
  return { latestMs, latestByUid, latestByEmail };
}

function isThreadParticipant(item) {
  if (!currentUser || !item) return false;
  if (item.uid === currentUser.uid) return true;
  if (normalizeEmail(item.userEmail || item.authorEmail) === normalizeEmail(currentUser.email)) return true;
  if (threadParticipationIds.has(item.id)) return true;
  const legacyReplies = Array.isArray(item.replies) ? item.replies : [];
  return legacyReplies.some((reply) => reply?.deleted !== true && reply?.hidden !== true && (
    reply?.uid === currentUser.uid || normalizeEmail(reply?.userEmail) === normalizeEmail(currentUser.email)
  ));
}

function hasUnreadThreadActivity(item) {
  if (!currentUser || !item || !isThreadParticipant(item)) return false;
  const { latestMs, latestByUid, latestByEmail } = getListingLatestReplyMeta(item);
  if (!latestMs) return false;
  if (latestByUid && latestByUid === currentUser.uid) return false;
  if (!latestByUid && latestByEmail && latestByEmail === normalizeEmail(currentUser.email)) return false;
  return latestMs > getThreadSeenAt(item.id);
}

function getUnreadThreadListings() {
  return listings.filter((item) => isVisibleToViewer(item) && hasUnreadThreadActivity(item));
}

function updateThreadNotificationUI() {
  const unreadItems = getUnreadThreadListings();
  threadUnreadCount = unreadItems.length;

  const badge = $('threadAlertsBadge');
  if (badge) {
    badge.style.display = threadUnreadCount ? 'inline-flex' : 'none';
    badge.textContent = threadUnreadCount ? `🔔 ${threadUnreadCount} new` : '';
  }

  const heroBadge = $('heroThreadAlert');
  if (heroBadge) {
    heroBadge.style.display = threadUnreadCount ? 'inline-flex' : 'none';
    heroBadge.textContent = threadUnreadCount === 1 ? '1 thread has new activity' : `${threadUnreadCount} threads have new activity`;
  }

  const threadNotice = $('threadUnreadNotice');
  if (threadNotice && activeThread) {
    threadNotice.style.display = hasUnreadThreadActivity(activeThread) ? 'block' : 'none';
  }
}

function scrollToFirstUnreadThread() {
  const unreadItems = getUnreadThreadListings();
  if (!unreadItems.length) {
    alert('No new thread activity right now.');
    return;
  }
  const target = document.querySelector(`[data-thread-card-id="${CSS.escape(unreadItems[0].id)}"]`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('thread-card-highlight');
    setTimeout(() => target.classList.remove('thread-card-highlight'), 1800);
  }
}

function stopParticipantRepliesListener() {
  if (participantRepliesUnsub) {
    participantRepliesUnsub();
    participantRepliesUnsub = null;
  }
  threadParticipationIds = new Set();
}

function startParticipantRepliesListener() {
  stopParticipantRepliesListener();
  if (!currentUser?.uid || !currentProfile) return;
  const qRef = query(collectionGroup(db, 'replies'), where('uid', '==', currentUser.uid));
  participantRepliesUnsub = onSnapshot(qRef, (snap) => {
    threadParticipationIds = new Set(
      snap.docs.map((d) => String(d.data()?.listingId || '').trim()).filter(Boolean)
    );
    updateThreadNotificationUI();
    renderListings();
  }, (err) => {
    console.error('Participant replies error:', err);
  });
}

async function deleteRelatedModerationFlags(listingId = '', replyId = '') {
  const queries = [];
  if (replyId) queries.push(getDocs(query(collection(db, 'moderationFlags'), where('replyId', '==', replyId))));
  else if (listingId) queries.push(getDocs(query(collection(db, 'moderationFlags'), where('listingId', '==', listingId))));
  if (!queries.length) return;
  const results = await Promise.all(queries);
  const seen = new Set();
  const deletes = [];
  results.forEach((snap) => {
    snap.forEach((flagDoc) => {
      if (seen.has(flagDoc.id)) return;
      seen.add(flagDoc.id);
      deletes.push(deleteDoc(flagDoc.ref).catch(() => {}));
    });
  });
  await Promise.all(deletes);
}

async function refreshListingReplySummary(listingId) {
  if (!listingId) return;
  const listingRef = doc(db, 'listings', listingId);
  const listingSnap = await getDoc(listingRef);
  if (!listingSnap.exists()) return;
  const listingData = listingSnap.data() || {};
  const legacyReplies = Array.isArray(listingData.replies) ? listingData.replies.filter((reply) => reply?.deleted !== true && reply?.hidden !== true) : [];
  const liveSnap = await getDocs(query(collection(db, 'listings', listingId, 'replies'), orderBy('createdAtMs', 'asc')));
  const liveReplies = liveSnap.docs.map((d) => d.data()).filter((reply) => reply?.deleted !== true && reply?.hidden !== true);

  const combined = [...legacyReplies, ...liveReplies].sort((a, b) => Number(a?.createdAtMs || a?.createdAt || 0) - Number(b?.createdAtMs || b?.createdAt || 0));
  const lastReply = combined.length ? combined[combined.length - 1] : null;
  await updateDoc(listingRef, {
    replyCount: combined.length,
    lastReplyAtMs: Number(lastReply?.createdAtMs || lastReply?.createdAt || 0) || null,
    lastReplyPreview: lastReply?.text ? buildModerationSnippet(lastReply.text, 120) : '',
    lastReplyByUid: lastReply?.uid || '',
    lastReplyByEmail: lastReply?.userEmail || '',
    updatedAt: serverTimestamp()
  }).catch(() => {});
}

async function hardDeleteReplyRecord(reply) {
  if (!reply?.listingId) return;
  const listingRef = doc(db, 'listings', reply.listingId);
  if (reply.source === 'legacy') {
    const listingSnap = await getDoc(listingRef);
    if (!listingSnap.exists()) return;
    const listingData = listingSnap.data() || {};
    const replies = Array.isArray(listingData.replies) ? listingData.replies.slice() : [];
    if (reply.legacyIndex < 0 || reply.legacyIndex >= replies.length) return;
    replies.splice(reply.legacyIndex, 1);
    await updateDoc(listingRef, { replies, updatedAt: serverTimestamp() });
    await refreshListingReplySummary(reply.listingId);
    return;
  }
  if (reply.path) {
    await deleteRelatedModerationFlags(reply.listingId, reply.id).catch(() => {});
    await deleteDoc(doc(db, reply.path)).catch(() => {});
    await refreshListingReplySummary(reply.listingId);
  }
}

async function hardDeleteListingFromFeed(listingId) {
  const item = listings.find((entry) => entry.id === listingId);
  if (!item) return;
  const confirmText = canModerate()
    ? 'Permanently delete this entire post and all replies? This fully removes the thread from the website.'
    : 'Delete this post permanently?';
  if (!confirm(confirmText)) return;

  const replySnap = await getDocs(query(collection(db, 'listings', listingId, 'replies'), orderBy('createdAtMs', 'asc'))).catch(() => null);
  if (replySnap) {
    await Promise.all(replySnap.docs.map((replyDoc) => deleteDoc(replyDoc.ref).catch(() => {})));
  }
  await deleteRelatedModerationFlags(listingId).catch(() => {});
  await deleteDoc(doc(db, 'listings', listingId));
  if (activeThread?.id === listingId) hide('threadOverlay');
  if (threadReadState?.[listingId]) {
    const next = { ...(threadReadState || {}) };
    delete next[listingId];
    threadReadState = next;
    persistThreadReadState();
  }
  updateThreadNotificationUI();
}


function hasRulesAcceptance(profile = currentProfile) {
  return !!(
    profile &&
    profile.rulesAccepted === true &&
    profile.rulesAcceptedVersion === MARKETPLACE_RULES_VERSION &&
    String(profile.rulesAcceptedName || '').trim() &&
    String(profile.rulesAcceptedFirstName || '').trim() &&
    String(profile.rulesAcceptedLastName || '').trim() &&
    Number(profile.rulesAcceptedAtMs || 0) > 0
  );
}


function expectedRulesFullName(profile = currentProfile, user = currentUser) {
  const source = String(
    profile?.displayName ||
    profile?.pendingName ||
    profile?.requestedName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    ''
  ).trim();
  return source.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}


function renderRulesList() {
  const list = $('rulesList');
  if (!list) return;
  list.innerHTML = MARKETPLACE_RULES.map((rule) => `<li>${rule}</li>`).join('');
  const expected = expectedRulesFullName();
  const expectedEl = $('rulesExpectedName');
  if (expectedEl) {
    expectedEl.textContent = expected
      ? `For security, type your full first and last name exactly as: ${expected}`
      : 'For security, type your full first and last name exactly as it should appear in your employee profile.';
  }

  const input = $('rulesFullName') || $('rulesFirstName');
  if (input) {
    input.placeholder = 'Enter your first and last name';
    input.setAttribute('autocomplete', 'name');
  }
}


function showRulesOverlay() {
  renderRulesList();
  const msg = $('rulesMsg');
  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
    msg.dataset.state = '';
  }
  const input = $('rulesFullName') || $('rulesFirstName');
  if (input) input.value = '';
  const check = $('rulesAcknowledge');
  if (check) check.checked = false;
  const overlay = $('rulesOverlay');
  if (overlay) overlay.style.display = 'flex';
  document.body.classList.add('modal-open');
  setTimeout(() => input?.focus(), 20);
}


function hideRulesOverlay() {
  const overlay = $('rulesOverlay');
  if (overlay) overlay.style.display = 'none';
  const stillOpen = ['nameOverlay', 'postOverlay', 'threadOverlay', 'passwordGateOverlay', 'rulesOverlay', 'eventImageOverlay'].some((overlayId) => {
    const o = $(overlayId);
    return o && (o.style.display === 'flex' || o.style.display === 'block');
  });
  if (!stillOpen) document.body.classList.remove('modal-open');
}

function isVisibleToViewer(item) {
  if (!item) return false;
  if (item.hidden && !isViewerAdmin()) return false;
  if (String(item.status || 'ACTIVE').toUpperCase() === 'SOLD' && !isViewerAdmin()) return false;
  return true;
}

function stopListeners() {
  if (listingsUnsub) {
    listingsUnsub();
    listingsUnsub = null;
  }
  if (profilesUnsub) {
    profilesUnsub();
    profilesUnsub = null;
  }
  if (userProfileUnsub) {
    userProfileUnsub();
    userProfileUnsub = null;
  }
  if (eventResponsesUnsub) {
    eventResponsesUnsub();
    eventResponsesUnsub = null;
  }
  stopActiveThreadRepliesListener();
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  listings = [];
  profiles = [];
  eventResponses = [];
  activeThread = null;
  updateHeroPeopleStats();
  renderEventSpotlight();
  renderBoards();
  renderListings();
}

async function forceAccessExit(message) {
  if (forcedAccessExitInFlight) return;
  forcedAccessExitInFlight = true;
  const notice = String(message || 'Your marketplace access has changed. Please sign in again or contact an admin.').trim();

  try {
    stopListeners();
    setLoginFlashMessage(notice);
    if ($('loginPassword')) $('loginPassword').value = '';
    await signOut(auth).catch(() => {});
    showPane('login');
    showLoginStatusMessage(notice);
    alert(notice);
  } finally {
    forcedAccessExitInFlight = false;
  }
}

function startUserProfileGuard(user) {
  if (!user || userProfileUnsub) return;

  const profileRef = doc(db, 'profiles', user.uid);
  userProfileUnsub = onSnapshot(profileRef, async (snap) => {
    if (!snap.exists()) {
      if (!isProtectedCoreAdmin(user.email)) {
        await forceAccessExit('Your marketplace profile could not be found. Please contact an admin.');
      }
      return;
    }

    const liveProfile = { id: snap.id, ...snap.data() };
    currentProfile = { ...(currentProfile || {}), ...liveProfile };

    if (isProtectedCoreAdmin(user.email)) return;

    if (liveProfile.banned === true) {
      await forceAccessExit('Your marketplace access has been disabled by an admin. Please contact Michael.H@regallakeland.com if you need help.');
      return;
    }

    if (!canCompleteMarketplaceLogin(liveProfile)) {
      await forceAccessExit(loginBlockedMessage(liveProfile));
      return;
    }

    updateAuthUI();
  }, async (err) => {
    console.error('User profile guard error:', err);
  });
}

async function ensureProfile(user) {
  const profileRef = doc(db, 'profiles', user.uid);
  const snap = await getDoc(profileRef);

  const baseProfile = {
    uid: user.uid,
    email: user.email || '',
    displayName: (user.displayName || '').trim(),
    pendingName: (user.displayName || '').trim(),
    isAdmin: isAdmin(user.email),
    isModerator: false,
    banned: false,
    manualVerified: isProtectedCoreAdmin(user.email) || isAdmin(user.email),
    emailVerified: !!user.emailVerified,
    accessApproved: isProtectedCoreAdmin(user.email) || isAdmin(user.email),
    accessManuallyDenied: false,
    approvalStatus: (isProtectedCoreAdmin(user.email) || isAdmin(user.email)) ? 'APPROVED' : 'PENDING_ADMIN_APPROVAL',
    signupSource: 'self-service',
    signupSubmittedAtMs: Date.now(),
    pendingApprovalAtMs: (isProtectedCoreAdmin(user.email) || isAdmin(user.email)) ? null : Date.now(),
    deleted: false,
    tempPasswordActive: false,
    mustChangePassword: false,
    rulesAccepted: false,
    rulesAcceptedVersion: '',
    rulesAcceptedName: '',
    rulesAcceptedFirstName: '',
    rulesAcceptedLastName: '',
    rulesAcceptedAt: null,
    rulesAcceptedAtMs: null,
    rulesAcceptedByUid: '',
    rulesAcceptedByEmail: '',
    rulesAcceptedDisplayNameSnapshot: '',
    lastSeenAtMs: Date.now(),
    lastLoginAtMs: Date.now(),
    lastActivityAtMs: Date.now(),
    lastActivityLabel: 'Signed in to marketplace',
    lastBoardVisited: 'ALL',
    lastThreadId: '',
    lastThreadTitle: '',
    currentView: 'ALL',
    updatedAt: serverTimestamp()
  };

  if (!snap.exists()) {
    await setDoc(profileRef, {
      ...baseProfile,
      createdAt: serverTimestamp()
    });
    currentProfile = {
      ...baseProfile,
      createdAt: Date.now()
    };
  } else {
    currentProfile = { id: snap.id, ...snap.data() };
    const updates = {};
    const authDisplayName = normalizePersonName(user.displayName || '');

    // Only backfill fields that the signed-in owner is allowed to update under Firestore rules.
    if (authDisplayName) {
      if (!normalizePersonName(currentProfile.displayName)) updates.displayName = authDisplayName;
      if (!normalizePersonName(currentProfile.pendingName)) updates.pendingName = authDisplayName;
      if (!normalizePersonName(currentProfile.requestedName)) updates.requestedName = authDisplayName;
    }
    if (typeof currentProfile.emailVerified !== 'boolean') updates.emailVerified = !!user.emailVerified;
    if (typeof currentProfile.tempPasswordActive !== 'boolean') updates.tempPasswordActive = false;
    if (typeof currentProfile.mustChangePassword !== 'boolean') updates.mustChangePassword = false;
    if (typeof currentProfile.rulesAccepted !== 'boolean') updates.rulesAccepted = false;
    if (typeof currentProfile.rulesAcceptedVersion !== 'string') updates.rulesAcceptedVersion = '';
    if (typeof currentProfile.rulesAcceptedName !== 'string') updates.rulesAcceptedName = '';
    if (typeof currentProfile.rulesAcceptedFirstName !== 'string') updates.rulesAcceptedFirstName = '';
    if (typeof currentProfile.rulesAcceptedLastName !== 'string') updates.rulesAcceptedLastName = '';
    if (typeof currentProfile.rulesAcceptedByUid !== 'string') updates.rulesAcceptedByUid = '';
    if (typeof currentProfile.rulesAcceptedByEmail !== 'string') updates.rulesAcceptedByEmail = '';
    if (typeof currentProfile.rulesAcceptedDisplayNameSnapshot !== 'string') updates.rulesAcceptedDisplayNameSnapshot = '';
    if (!Object.prototype.hasOwnProperty.call(currentProfile, 'rulesAcceptedAt')) updates.rulesAcceptedAt = null;
    if (!Number.isFinite(Number(currentProfile.rulesAcceptedAtMs || 0))) updates.rulesAcceptedAtMs = null;
    if (!Number.isFinite(Number(currentProfile.lastSeenAtMs || 0))) updates.lastSeenAtMs = Date.now();
    if (!Number.isFinite(Number(currentProfile.lastLoginAtMs || 0))) updates.lastLoginAtMs = Number(currentProfile.lastSeenAtMs || Date.now());
    if (!Number.isFinite(Number(currentProfile.lastActivityAtMs || 0))) updates.lastActivityAtMs = Number(currentProfile.lastSeenAtMs || Date.now());
    if (typeof currentProfile.lastActivityLabel !== 'string') updates.lastActivityLabel = 'Active on marketplace';
    if (typeof currentProfile.lastBoardVisited !== 'string') updates.lastBoardVisited = 'ALL';
    if (typeof currentProfile.lastThreadId !== 'string') updates.lastThreadId = '';
    if (typeof currentProfile.lastThreadTitle !== 'string') updates.lastThreadTitle = '';
    if (typeof currentProfile.currentView !== 'string') updates.currentView = currentProfile.lastBoardVisited || 'ALL';

    if (user.emailVerified && currentProfile.emailVerified !== true) {
      updates.emailVerified = true;
      updates.emailVerifiedAt = Date.now();
    }
    if (isProtectedCoreAdmin(user.email) && currentProfile.isAdmin !== true) {
      updates.isAdmin = true;
    }
    if (isProtectedCoreAdmin(user.email) && currentProfile.accessApproved !== true) {
      updates.accessApproved = true;
      updates.approvalStatus = 'APPROVED';
      updates.pendingApprovalAtMs = null;
    }

    if (Object.keys(updates).length) {
      updates.updatedAt = serverTimestamp();
      try {
        await updateDoc(profileRef, updates);
        currentProfile = { ...currentProfile, ...updates };
      } catch (err) {
        console.warn('Profile backfill skipped due to rules mismatch or legacy fields:', err);
      }
    }
  }
}

function updateAuthUI() {
  const loggedIn = !!currentUser && !!currentProfile;
  document.body.classList.toggle('auth-open', !loggedIn);

  if ($('pillUser')) {
    $('pillUser').textContent = loggedIn
      ? (currentProfile.displayName || currentUser.email)
      : 'Not signed in';
  }

  const showAdmin = loggedIn && (!!currentProfile?.isAdmin || isProtectedCoreAdmin(currentUser?.email));
  if ($('adminLink')) $('adminLink').style.display = showAdmin ? 'inline-flex' : 'none';
  if ($('btnLogout')) $('btnLogout').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('btnNew')) $('btnNew').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('threadAlertsBadge')) $('threadAlertsBadge').style.display = loggedIn && threadUnreadCount ? 'inline-flex' : 'none';
  if ($('heroThreadAlert')) $('heroThreadAlert').style.display = loggedIn && threadUnreadCount ? 'inline-flex' : 'none';
  if ($('loginOverlay')) $('loginOverlay').style.display = loggedIn ? 'none' : 'flex';
  if (!loggedIn) { hidePasswordGate(); hideRulesOverlay(); }

  if (loggedIn) {
    const visibleOverlayIds = ['nameOverlay', 'postOverlay', 'threadOverlay', 'passwordGateOverlay', 'eventImageOverlay'];
    const hasVisibleModal = visibleOverlayIds.some((overlayId) => {
      const o = $(overlayId);
      return o && (o.style.display === 'flex' || o.style.display === 'block');
    });
    if (!hasVisibleModal) document.body.classList.remove('modal-open');
  }
}

async function handleLogin() {
  if (loginInFlight) return;
  loginInFlight = true;

  const emailInput = $('loginEmail')?.value.trim().toLowerCase() || '';
  const email = emailInput.includes('@') ? emailInput : (emailInput ? `${emailInput}@regallakeland.com` : '');

  if ($('loginEmail') && email) $('loginEmail').value = email;

  const password = $('loginPassword')?.value || '';

  if (!email || !password) {
    loginInFlight = false;
    alert('Enter email and password.');
    return;
  }
  if (!isAllowedEmail(email)) {
    loginInFlight = false;
    alert('Use your Regal Lakeland username only or your full @regallakeland.com email.');
    return;
  }

  clearLoginStatusMessage();
  localStorage.setItem('regal_saved_email', email);
  setTempLoginContext(email, password);

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    clearTempLoginContext();
    console.error(err);
    if (err?.code === 'auth/invalid-credential') {
      alert('That email/password combination was rejected. Check your password and try again.');
      return;
    }
    alert(`${err?.code || 'login_error'} — ${err?.message || 'Login failed.'}`);
  } finally {
    loginInFlight = false;
  }
}


function showPasswordGate() {
  const msg = $('passwordGateMsg');
  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
    msg.dataset.state = '';
  }
  if ($('newPasswordInput')) $('newPasswordInput').value = '';
  if ($('confirmNewPasswordInput')) $('confirmNewPasswordInput').value = '';
  const gate = $('passwordGateOverlay');
  if (gate) gate.style.display = 'flex';
  document.body.classList.add('modal-open');
  setTimeout(() => {
    gate?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('newPasswordInput')?.focus();
  }, 20);
}

function hidePasswordGate() {
  const gate = $('passwordGateOverlay');
  if (gate) gate.style.display = 'none';
  document.body.classList.remove('modal-open');
}

async function handleForcePasswordChange() {
  const password = $('newPasswordInput')?.value || '';
  const password2 = $('confirmNewPasswordInput')?.value || '';
  const msg = $('passwordGateMsg');

  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
    msg.dataset.state = '';
  }

  if (!currentUser) {
    alert('Please log in again.');
    return;
  }

  if (!password || !password2) {
    if (msg) {
      msg.textContent = 'Enter and confirm your new password.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  if (password.length < 8) {
    if (msg) {
      msg.textContent = 'Use at least 8 characters for your new password.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  if (password !== password2) {
    if (msg) {
      msg.textContent = 'The passwords do not match.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  try {
    const recentTempPassword = getTempLoginPasswordForCurrentUser();
    if (recentTempPassword && currentUser?.email) {
      const credential = EmailAuthProvider.credential(currentUser.email, recentTempPassword);
      await reauthenticateWithCredential(currentUser, credential);
    }

    await updatePassword(currentUser, password);
    await updateDoc(doc(db, 'profiles', currentUser.uid), {
      mustChangePassword: false,
      tempPasswordActive: false,
      passwordChangedAtMs: Date.now(),
      updatedAt: serverTimestamp()
    });

    if (currentProfile) {
      currentProfile.mustChangePassword = false;
      currentProfile.tempPasswordActive = false;
      currentProfile.passwordChangedAtMs = Date.now();
    }

    clearTempLoginContext();

    if (msg) {
      msg.textContent = 'Password updated successfully.';
      msg.dataset.state = 'success';
      msg.style.display = 'block';
    }

    setTimeout(() => {
      hidePasswordGate();
      document.body.classList.remove('modal-open');
      if (currentProfile) currentProfile.tempPasswordActive = false;
      renderListings();
      if (currentProfile && !hasRulesAcceptance(currentProfile)) {
        showRulesOverlay();
        return;
      }
      if (currentProfile && !currentProfile.displayName) {
        $('displayNameInput').value = currentUser.email?.split('@')[0]?.replace(/[._]/g, ' ') || '';
        show('nameOverlay');
      }
    }, 500);
  } catch (err) {
    console.error(err);
    const code = String(err?.code || '');
    if (msg) {
      msg.textContent = code === 'auth/requires-recent-login'
        ? 'Your login session is no longer fresh enough to change the password. Log out, log back in with the temporary password, and try again immediately.'
        : `${err?.code || 'password_change_error'} — ${err?.message || 'Could not change password.'}`;
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    if (code === 'auth/requires-recent-login') {
      await signOut(auth).catch(() => {});
    }
  }
}

async function handleSignup() {
  if (signupInFlight) return;
  const fullName = normalizePersonName(
    $('signupFullName')?.value ||
    $('signupName')?.value ||
    ''
  );

  const emailInput = $('signupEmail')?.value.trim().toLowerCase() || '';
  const email = emailInput.includes('@') ? emailInput : (emailInput ? `${emailInput}@regallakeland.com` : '');

  if ($('signupEmail') && email) $('signupEmail').value = email;

  const password =
    $('signupPassword')?.value ||
    '';

  const password2 =
    $('signupConfirmPassword')?.value ||
    $('signupPassword2')?.value ||
    '';

  const msg = $('signupMsg');
  const signupBtn = $('btnSignup');

  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
  }

  if (!fullName || !email || !password || !password2) {
    alert('Complete all signup fields.');
    return;
  }

  if (fullName.split(/\s+/).length < 2) {
    alert('Enter first and last name.');
    return;
  }

  if (!isAllowedEmail(email)) {
    alert('Use your @regallakeland.com email.');
    return;
  }

  if (password.length < 6) {
    alert('Password must be at least 6 characters.');
    return;
  }

  if (password !== password2) {
    alert('Passwords do not match.');
    return;
  }

  localStorage.setItem('regal_saved_email', email);

  try {
    signupInFlight = true;
    signupFlowContext = { email };
    if (signupBtn) signupBtn.disabled = true;

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: fullName }).catch((err) => {
      console.warn('signup_display_name_update_failed', err);
    });
    const elevated = isProtectedCoreAdmin(email);
    const profilePayload = buildPendingProfileData(cred.user, fullName, elevated);

    try {
      await writeProfileWithRetry(cred.user.uid, profilePayload, 5);
    } catch (profileErr) {
      console.error('profile_write_error', profileErr);
      try {
        await cred.user.delete();
      } catch (cleanupErr) {
        console.error('signup_cleanup_error', cleanupErr);
      }
      throw new Error('We could not finish creating your approval record. No account was left active. Please try again.');
    }

    await signOut(auth).catch(() => {});
    currentUser = null;
    currentProfile = null;
    updateAuthUI();

    clearLoginStatusMessage();
    if (msg) {
      msg.textContent = '';
      msg.style.display = 'none';
    }

    const createdMessage = approvalCreatedMessage();
    setLoginFlashMessage(createdMessage);

    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginPassword')) $('loginPassword').value = '';
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';
    showPane('login');
    showLoginStatusMessage(createdMessage);
    alert(createdMessage);
    setTimeout(() => $('loginPassword')?.focus(), 30);
  } catch (err) {
    console.error(err);

    if (err?.code === 'auth/email-already-in-use') {
      alert('That email is already registered.');
      return;
    }

    alert(`${err?.code || 'signup_error'} — ${err?.message || 'Signup failed.'}`);
  } finally {
    signupInFlight = false;
    signupFlowContext = null;
    if (signupBtn) signupBtn.disabled = false;
  }
}


async function handleRulesAgreement() {
  const input = $('rulesFullName') || $('rulesFirstName');
  const typedName = String(input?.value || '').trim();
  const acknowledged = !!$('rulesAcknowledge')?.checked;
  const msg = $('rulesMsg');
  const expected = expectedRulesFullName();

  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
    msg.dataset.state = '';
  }

  if (!currentUser || !currentProfile) {
    alert('Please log in again.');
    return;
  }

  if (!typedName) {
    if (msg) {
      msg.textContent = 'Enter your first and last name.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  if ($('rulesAcknowledge') && !acknowledged) {
    if (msg) {
      msg.textContent = 'You must check the acknowledgment box before continuing.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  const cleanedTyped = typedName.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = cleanedTyped.split(' ').filter(Boolean);

  if (parts.length < 2) {
    if (msg) {
      msg.textContent = 'You must enter both your first and last name.';
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  if (expected && cleanedTyped.toLowerCase() !== expected.toLowerCase()) {
    if (msg) {
      msg.textContent = `The name entered does not match ${expected}.`;
      msg.dataset.state = 'error';
      msg.style.display = 'block';
    }
    return;
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  const now = Date.now();

  const payload = {
    rulesAccepted: true,
    rulesAcceptedVersion: MARKETPLACE_RULES_VERSION,
    rulesAcceptedName: cleanedTyped,
    rulesAcceptedFirstName: firstName,
    rulesAcceptedLastName: lastName,
    rulesAcceptedAt: serverTimestamp(),
    rulesAcceptedAtMs: now,
    rulesAcceptedByUid: currentUser.uid,
    rulesAcceptedByEmail: String(currentUser.email || '').toLowerCase(),
    rulesAcceptedDisplayNameSnapshot: String(currentProfile.displayName || currentProfile.pendingName || currentProfile.requestedName || cleanedTyped),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, 'profiles', currentUser.uid), payload);
    currentProfile = { ...currentProfile, ...payload };
    hideRulesOverlay();
    updateAuthUI();
    if (!currentProfile.displayName) {
      $('displayNameInput').value = currentUser.email?.split('@')[0]?.replace(/[._]/g, ' ') || '';
      show('nameOverlay');
    }
  } catch (err) {
    console.error(err);
    try {
      const minimalPayload = {
        rulesAccepted: true,
        rulesAcceptedVersion: MARKETPLACE_RULES_VERSION,
        rulesAcceptedName: cleanedTyped,
        rulesAcceptedFirstName: firstName,
        rulesAcceptedLastName: lastName,
        rulesAcceptedAtMs: now,
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'profiles', currentUser.uid), minimalPayload);
      currentProfile = { ...currentProfile, ...minimalPayload };
      hideRulesOverlay();
      updateAuthUI();
      if (!currentProfile.displayName) {
        $('displayNameInput').value = currentUser.email?.split('@')[0]?.replace(/[._]/g, ' ') || '';
        show('nameOverlay');
      }
      return;
    } catch (retryErr) {
      console.error('Rules agreement retry failed:', retryErr);
      if (msg) {
        msg.textContent = `${retryErr?.code || err?.code || 'rules_save_error'} — ${retryErr?.message || err?.message || 'Could not save your agreement.'}`;
        msg.dataset.state = 'error';
        msg.style.display = 'block';
      }
    }
  }
}


async function handleResendVerification() {
  alert('Verification links are disabled in this build. New accounts are approved manually by admin after review.');
}


async function handleSaveName() {
  const name = $('displayNameInput')?.value.trim();
  if (!currentUser) {
    alert('Please log in again.');
    return;
  }
  if (!name) {
    alert('Enter your name.');
    return;
  }

  await updateDoc(doc(db, 'profiles', currentUser.uid), {
    displayName: name,
    pendingName: name,
    requestedName: name,
    updatedAt: serverTimestamp()
  });

  currentProfile.displayName = name;
  updateAuthUI();
  hide('nameOverlay');
}


function getActiveViewKey() {
  if (activeThread && $('threadOverlay') && $('threadOverlay').style.display !== 'none') return 'THREAD';
  return activeBoard || 'ALL';
}

async function logMarketplaceActivity(label = '', extra = {}, options = {}) {
  if (!currentUser) return;
  const force = options?.force === true;
  const now = Date.now();
  const cleanLabel = String(label || '').trim();
  const viewKey = String(extra?.currentView || getActiveViewKey() || 'ALL');
  const boardKey = String(extra?.lastBoardVisited || activeBoard || 'ALL');
  const dedupeKey = [cleanLabel, viewKey, boardKey, extra?.lastThreadId || '', extra?.lastThreadTitle || ''].join('|');

  if (!force && now - lastActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS && dedupeKey === lastActivityWriteKey) {
    return;
  }

  const payload = {
    ...extra,
    lastSeenAtMs: now,
    updatedAt: serverTimestamp()
  };

  if (!Object.prototype.hasOwnProperty.call(payload, 'lastBoardVisited')) payload.lastBoardVisited = boardKey;
  if (!Object.prototype.hasOwnProperty.call(payload, 'currentView')) payload.currentView = viewKey;
  if (cleanLabel) {
    payload.lastActivityLabel = cleanLabel;
    payload.lastActivityAtMs = now;
  }

  try {
    await updateDoc(doc(db, 'profiles', currentUser.uid), payload);
    if (currentProfile) Object.assign(currentProfile, { ...extra, ...payload, updatedAt: now });
    lastActivityWriteAt = now;
    lastActivityWriteKey = dedupeKey;
  } catch (err) {
    console.warn('activity update failed', err);
  }
}

async function touchPresence() {
  if (!currentUser) return;
  const stamp = Date.now();
  try {
    await updateDoc(doc(db, 'profiles', currentUser.uid), {
      lastSeenAtMs: stamp,
      lastBoardVisited: activeBoard || 'ALL',
      currentView: getActiveViewKey(),
      updatedAt: serverTimestamp()
    });
    if (currentProfile) {
      currentProfile.lastSeenAtMs = stamp;
      currentProfile.lastBoardVisited = activeBoard || 'ALL';
      currentProfile.currentView = getActiveViewKey();
    }
  } catch (err) {
    console.warn('presence update failed', err);
  }
}

function approvedProfiles() {
  return profiles.filter((profile) => profile && profile.accessApproved !== false && profile.banned !== true);
}

function onlineProfiles() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  return approvedProfiles().filter((profile) => Number(profile.lastSeenAtMs || 0) >= cutoff);
}

function updateHeroPeopleStats() {
  if ($('heroRegisteredCount')) $('heroRegisteredCount').textContent = String(approvedProfiles().length);
  if ($('heroOnlineCount')) $('heroOnlineCount').textContent = String(onlineProfiles().length);
}

function featuredEventResponses() {
  return eventResponses.filter((item) => item && item.eventId === FEATURED_EVENT.id);
}

function featuredEventCounts() {
  const counts = { ATTENDING: 0, MAYBE: 0, CANT: 0 };
  featuredEventResponses().forEach((item) => {
    const key = String(item.status || '').toUpperCase();
    if (counts[key] !== undefined) counts[key] += 1;
  });
  return counts;
}

function currentUserEventResponse() {
  if (!currentUser) return null;
  return featuredEventResponses().find((item) => item.uid === currentUser.uid) || null;
}

function canUseEventRsvp() {
  return !!(currentUser
    && currentProfile
    && currentProfile.banned !== true
    && /@regallakeland\.com$/i.test(String(currentUser.email || '')));
}

function renderEventSpotlight() {
  if (!$('featuredEventCard')) return;
  if ($('eventImage')) $('eventImage').src = FEATURED_EVENT.imageUrl;
  if ($('eventImageLarge')) $('eventImageLarge').src = FEATURED_EVENT.imageUrl;
  if ($('eventStatusText')) {
    $('eventStatusText').textContent = 'Tap RSVP HERE to open the event page directly, or click the flyer to enlarge the barcode for scanning.';
  }
}


async function handleEventRsvp(status) {
  show('eventImageOverlay');
  if ($('eventStatusText')) {
    $('eventStatusText').textContent = 'Use RSVP HERE to open the event page directly, or scan the barcode on the flyer. The website does not record RSVPs.';
  }
}

function startEventResponsesListener() {
  if (eventResponsesUnsub) return;
  eventResponsesUnsub = onSnapshot(collection(db, 'eventResponses'), (snap) => {
    eventResponses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEventSpotlight();
  }, (err) => {
    console.error('Event responses error:', err);
  });
}

function startProfilesListener() {
  if (profilesUnsub) return;
  profilesUnsub = onSnapshot(collection(db, 'profiles'), (snap) => {
    profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateHeroPeopleStats();
  }, (err) => {
    console.error('Profiles error:', err);
  });
}


function stopActiveThreadRepliesListener() {
  if (activeThreadRepliesUnsub) {
    activeThreadRepliesUnsub();
    activeThreadRepliesUnsub = null;
  }
  activeThreadReplyDocs = [];
}

function normalizeReplyRecord(reply, source = 'legacy', legacyIndex = -1) {
  const createdAtMs = Number(reply?.createdAtMs || reply?.createdAt || Date.now());
  return {
    ...reply,
    source,
    legacyIndex,
    sourceKey: reply?.sourceKey || (source === 'legacy' ? `legacy:${reply?.listingId || activeThread?.id || ''}:${legacyIndex}` : `reply:${reply?.id || ''}`),
    listingId: reply?.listingId || activeThread?.id || '',
    deleted: reply?.deleted === true,
    hidden: reply?.hidden === true,
    flagged: reply?.flagged === true,
    moderationLabels: Array.isArray(reply?.moderationLabels) ? reply.moderationLabels : [],
    moderationMatchedTerms: Array.isArray(reply?.moderationMatchedTerms) ? reply.moderationMatchedTerms : [],
    displayName: reply?.displayName || reply?.authorName || reply?.userEmail || 'Unknown',
    createdAtMs
  };
}

function mergedRepliesForThread(item = activeThread) {
  const legacyReplies = Array.isArray(item?.replies)
    ? item.replies.map((reply, index) => normalizeReplyRecord(reply, 'legacy', index))
    : [];
  const liveReplies = activeThreadReplyDocs.map((reply) => normalizeReplyRecord(reply, 'doc', -1));
  return [...legacyReplies, ...liveReplies]
    .filter((reply) => canModerate() || (reply.deleted !== true && reply.hidden !== true))
    .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
}

function startActiveThreadRepliesListener(listingId) {
  stopActiveThreadRepliesListener();
  if (!listingId || !currentUser || !currentProfile) return;
  const qRef = query(collection(db, 'listings', listingId, 'replies'), orderBy('createdAtMs', 'asc'));
  activeThreadRepliesUnsub = onSnapshot(qRef, (snap) => {
    activeThreadReplyDocs = snap.docs.map((d) => ({ id: d.id, path: d.ref.path, sourceKey: `reply:${d.id}`, ...d.data() }));
    if (activeThread && activeThread.id === listingId && $('threadOverlay')?.style.display !== 'none') {
      renderReplies(mergedRepliesForThread(activeThread));
    }
    updateThreadNotificationUI();
  }, (err) => {
    console.error('Thread replies error:', err);
  });
}

function startListingsListener() {
  if (listingsUnsub) return;

  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  listingsUnsub = onSnapshot(qRef, (snap) => {
    listings = snap.docs.map((d) => normalizeListing({ id: d.id, ...d.data() }));
    renderBoards();
    renderListings();
    updateThreadNotificationUI();

    if (activeThread && $('threadOverlay')?.style.display !== 'none') {
      const updatedThread = listings.find((x) => x.id === activeThread.id);
      if (updatedThread) {
        activeThread = updatedThread;
        renderReplies(mergedRepliesForThread(activeThread));
      }
    }
  }, (err) => {
    console.error(err);
    alert(`Listings error: ${err?.message || err}`);
  });
}

function normalizeListing(item) {
  const board = item.board || item.category || 'BUYSELL';
  return {
    ...item,
    board,
    authorEmail: item.authorEmail || item.userEmail || '',
    authorName: item.authorName || item.displayName || item.userEmail || '',
    description: item.description || item.desc || '',
    imageUrl: item.imageUrl || item.photo || '',
    imageUrls: getListingImageUrls(item),
    reactivationRequested: !!item.reactivationRequested,
    featured: !!item.featured,
    hidden: !!item.hidden,
    lastReplyByUid: item.lastReplyByUid || '',
    lastReplyByEmail: item.lastReplyByEmail || '',
    status: String(item.status || 'ACTIVE').toUpperCase(),
    replies: Array.isArray(item.replies) ? item.replies : [],
    replyCount: Number(item.replyCount || 0)
  };
}

function shouldIncludeInBoardSummary(item, boardKey = 'ALL') {
  if (!isVisibleToViewer(item)) return false;
  const status = String(item?.status || 'ACTIVE').toUpperCase();
  if (status === 'SOLD') return false;
  if (item?.board === 'PICTURES') return false;
  return boardKey === 'ALL' || item?.board === boardKey;
}

function boardCounts() {
  const summaryItems = listings.filter((item) => shouldIncludeInBoardSummary(item));
  const counts = { ALL: summaryItems.length };
  BOARD_DEFS.forEach((b) => { if (b.key !== 'ALL') counts[b.key] = 0; });
  summaryItems.forEach((item) => { counts[item.board] = (counts[item.board] || 0) + 1; });
  return counts;
}


function latestForBoard(boardKey) {
  const list = listings.filter((item) => shouldIncludeInBoardSummary(item, boardKey));
  return list[0] || null;
}


function renderBoards() {
  const wrap = $('boards');
  if (!wrap) return;

  const counts = boardCounts();
  wrap.innerHTML = BOARD_DEFS.map((board) => {
    const isPicturesBoard = board.key === 'PICTURES';
    const last = latestForBoard(board.key);
    const countText = isPicturesBoard ? 'Open' : String(counts[board.key] || 0);
    const lastText = isPicturesBoard
      ? 'Launch the standalone gallery designer'
      : (last ? esc(last.title || 'Latest post') : 'No posts yet');
    return `
      <button class="boardBtn ${activeBoard === board.key ? 'active' : ''}" data-board="${board.key}" type="button">
        <div>
          <div class="board-label">${esc(board.label)}</div>
          <div class="board-desc">${esc(board.desc)}</div>
        </div>
        <div class="board-meta">
          <div class="board-count">${countText}</div>
          <div class="board-last">${lastText}</div>
        </div>
      </button>
    `;
  }).join('');

  wrap.querySelectorAll('.boardBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const boardKey = btn.dataset.board;
      if (boardKey === 'PICTURES') {
        window.location.href = 'pictures.html';
        return;
      }
      activeBoard = boardKey;
      renderBoards();
      renderListings();
      const boardMeta = BOARD_DEFS.find((b) => b.key === activeBoard);
      void logMarketplaceActivity(`Opened ${boardMeta?.label || activeBoard} board`, {
        lastBoardVisited: activeBoard,
        currentView: activeBoard,
        lastThreadId: '',
        lastThreadTitle: ''
      }, { force: true });
    });
  });

  if ($('boardPill')) $('boardPill').textContent = BOARD_DEFS.find((b) => b.key === activeBoard)?.label || 'All';
  if ($('heroBoardCount')) $('heroBoardCount').textContent = String(BOARD_DEFS.length - 1);
}

function filteredListings() {
  const q = $('q')?.value.trim().toLowerCase() || '';
  const st = $('st')?.value || 'ALL';
  const sort = $('sort')?.value || 'NEW';

  let data = listings.filter((item) => isVisibleToViewer(item) && item.board !== 'PICTURES' && (activeBoard === 'ALL' || item.board === activeBoard));

  if (st !== 'ALL') {
    data = data.filter((item) => (item.status || 'ACTIVE') === st);
  }

  if (q) {
    data = data.filter((item) => {
      const hay = [
        item.title,
        item.description,
        item.location,
        item.contact,
        item.authorName,
        item.authorEmail
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  data.sort((a, b) => {
    const ap = Number(a.price || 0);
    const bp = Number(b.price || 0);
    if (sort === 'OLD') return Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0);
    if (sort === 'PRICE_ASC') return ap - bp;
    if (sort === 'PRICE_DESC') return bp - ap;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });

  return data;
}


function formatPrice(v) {
  const n = Number(v || 0);
  if (!n) return 'Free';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(ms) {
  try { return new Date(Number(ms || Date.now())).toLocaleString(); } catch { return '—'; }
}

function getListingImageUrls(item) {
  const urls = [];
  if (Array.isArray(item?.imageUrls)) {
    item.imageUrls.forEach((url) => {
      const clean = String(url || '').trim();
      if (clean && !urls.includes(clean)) urls.push(clean);
    });
  }
  [item?.imageUrl, item?.photo].forEach((url) => {
    const clean = String(url || '').trim();
    if (clean && !urls.includes(clean)) urls.unshift(clean);
  });
  return urls.filter(Boolean);
}

function getListingDisplayValue(item) {
  const board = String(item?.board || item?.category || '').toUpperCase();
  if (board === 'PICTURES') {
    const count = getListingImageUrls(item).length;
    if (count > 1) return `${count} Photos`;
    if (count === 1) return '1 Photo';
    return 'Gallery';
  }
  return formatPrice(item?.price);
}

function buildGalleryPreview(item) {
  const images = getListingImageUrls(item);
  if (!images.length) return '';
  const preview = images.slice(0, 4);
  const extra = images.length - preview.length;
  return `<div class="galleryPreview galleryPreview-${preview.length}">${preview.map((url, idx) => `<div class="galleryPreviewCell ${idx === 0 ? 'primary' : ''}"><img src="${esc(url)}" alt="${esc(item?.title || 'Gallery image')}" loading="lazy" /></div>`).join('')}${extra > 0 ? `<div class="galleryPreviewMore">+${extra}</div>` : ''}</div>`;
}

function buildThreadGallery(item) {
  const images = getListingImageUrls(item);
  if (!images.length) return '';
  return `<div class="thread-gallery-wrap"><div class="thread-gallery-grid">${images.map((url, idx) => `<div class="thread-gallery-item"><img class="thread-gallery-image" src="${esc(url)}" alt="${esc((item?.title || 'Gallery image') + ' ' + (idx + 1))}" loading="lazy" /></div>`).join('')}</div></div>`;
}

function canModify(item) {
  return !!currentUser && !!currentProfile && (canModerate() || currentUser.uid === item.uid);
}

function getPosterDisplayName(item) {
  return normalizePersonName(item?.authorName || item?.displayName || '') || item?.authorEmail || item?.userEmail || 'Marketplace Member';
}

function getPosterContactValue(item) {
  const contact = String(item?.contact || '').trim();
  if (contact) return contact;
  return String(item?.authorEmail || item?.userEmail || '').trim();
}

function resetPostEditor() {
  editingPostId = null;
  const titleEl = $('postOverlay')?.querySelector('.modal-h strong');
  if (titleEl) titleEl.textContent = 'Create Post';
  if ($('btnSavePost')) $('btnSavePost').textContent = 'Post Listing';
  if ($('fBoard')) $('fBoard').value = 'FREE';
  if ($('fStatus')) $('fStatus').value = 'ACTIVE';
  if ($('fTitle')) $('fTitle').value = '';
  if ($('fPrice')) $('fPrice').value = '';
  if ($('fLocation')) $('fLocation').value = '';
  if ($('fDesc')) $('fDesc').value = '';
  if ($('fContact')) $('fContact').value = '';
  if ($('fPhoto')) $('fPhoto').value = '';
}

function openPostEditor(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  editingPostId = id;
  const titleEl = $('postOverlay')?.querySelector('.modal-h strong');
  if (titleEl) titleEl.textContent = 'Edit Post';
  if ($('btnSavePost')) $('btnSavePost').textContent = 'Save Changes';
  if ($('fBoard')) $('fBoard').value = item.board || 'FREE';
  if ($('fStatus')) $('fStatus').value = String(item.status || 'ACTIVE').toUpperCase();
  if ($('fTitle')) $('fTitle').value = item.title || '';
  if ($('fPrice')) $('fPrice').value = item.price ?? '';
  if ($('fLocation')) $('fLocation').value = item.location || '';
  if ($('fDesc')) $('fDesc').value = item.description || item.desc || '';
  if ($('fContact')) $('fContact').value = item.contact || '';
  if ($('fPhoto')) $('fPhoto').value = '';
  show('postOverlay');
}

function renderListings() {
  const wrap = $('cards');
  const empty = $('empty');
  if (!wrap || !empty) return;

  const visibleListings = listings.filter((item) => isVisibleToViewer(item));
  const data = filteredListings();
  const latest = data[0] || visibleListings[0] || null;

  if ($('feedTitle')) $('feedTitle').textContent = BOARD_DEFS.find((b) => b.key === activeBoard)?.label || 'All Boards';
  if ($('boardPill')) $('boardPill').textContent = BOARD_DEFS.find((b) => b.key === activeBoard)?.label || 'All';
  if ($('countLine')) $('countLine').textContent = `${data.length} shown | ${visibleListings.length} live`;
  if ($('heroListingCount')) $('heroListingCount').textContent = String(visibleListings.length);
  updateHeroPeopleStats();
  renderEventSpotlight();
  if ($('heroRecentText')) $('heroRecentText').textContent = latest ? latest.title : 'Waiting for new posts';

  if (!data.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    updateThreadNotificationUI();
    return;
  }

  empty.style.display = 'none';
  wrap.classList.toggle('pictureBoardActive', activeBoard === 'PICTURES');
  wrap.innerHTML = data.map((item) => {
    const statusClass = item.status === 'SOLD' ? 'sold' : item.reactivationRequested ? 'pending' : 'active';
    const statusText = item.reactivationRequested ? 'Reactivation Requested' : ((item.status === 'SOLD') ? getClosedLabel(item) : (item.status || 'ACTIVE'));
    const showRequestActive = isViewerAdmin() && item.status === 'SOLD' && currentUser && currentUser.uid === item.uid && !item.reactivationRequested;
    const requestPending = item.status === 'SOLD' && item.reactivationRequested && currentUser && currentUser.uid === item.uid;
    const featuredPill = item.featured ? `<span class="status featured">Featured</span>` : '';
    const unread = hasUnreadThreadActivity(item);
    const unreadBadge = unread ? '<span class="threadUnreadBadge" title="New activity in this thread">● New</span>' : '';
    const quickDelete = canModerate() ? `<button class="btn danger" data-action="deletePost" data-id="${esc(item.id)}" type="button">Delete</button>` : '';
    const posterName = getPosterDisplayName(item);
    const posterContact = getPosterContactValue(item);
    const posterContactText = posterContact && normalizeEmail(posterContact) !== normalizeEmail(item.authorEmail || item.userEmail || '')
      ? `<span class="topicPosterContact">${esc(posterContact)}</span>`
      : '';
    const boardLabel = BOARD_DEFS.find((b) => b.key === item.board)?.label || item.board;
    const imageUrls = getListingImageUrls(item);
    const visualValue = getListingDisplayValue(item);
    const isPictureBoard = String(item.board || '').toUpperCase() === 'PICTURES';
    const galleryPreview = isPictureBoard ? buildGalleryPreview(item) : '';
    const sideMeta = isPictureBoard
      ? `<div class="topicMeta topicMetaRight"><span>${esc(imageUrls.length ? `${imageUrls.length} image${imageUrls.length === 1 ? '' : 's'}` : 'No images')}</span><span>${esc(item.location || 'Regal gallery')}</span></div>`
      : `<div class="topicMeta topicMetaRight"><span>${esc(item.location || 'No location')}</span><span>${esc(item.contact || 'No contact')}</span></div>`;
    return `
      <article class="topicRow ${unread ? 'topicRow-unread' : ''} ${isPictureBoard ? 'galleryTopicRow' : ''}" data-thread-card-id="${esc(item.id)}">
        <div class="topicMain">
          <div class="topicHeader">
            <div class="topicTitleWrap">
              <div class="topicTitle">${esc(item.title || 'Untitled')}</div>
              ${unreadBadge}
            </div>
            <span class="status ${statusClass}">${esc(statusText)}</span>${featuredPill}
          </div>
          <div class="topicPosterBar" title="Thread owner">
            <span class="topicPosterEyebrow">Posted by</span>
            <span class="topicPosterName">${esc(posterName)}</span>
            ${posterContactText}
          </div>
          <div class="topicMeta">
            <span>${esc(boardLabel)}</span>
            <span>${esc(formatDate(item.createdAtMs))}</span>
            ${item.lastReplyAtMs ? `<span>${esc(formatDate(item.lastReplyAtMs))} latest reply</span>` : ''}
          </div>
          ${galleryPreview ? `<div class="topicGalleryPreviewWrap">${galleryPreview}</div>` : ''}
          <div class="topicDesc">${esc(item.description || '').slice(0, 220)}${(item.description || '').length > 220 ? '…' : ''}</div>
          <div class="rowBtns">
            <button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open</button>
            ${canModify(item) ? `<button class="btn ghost" data-action="editPost" data-id="${esc(item.id)}" type="button">Edit</button>` : ''}
            ${canModify(item) && item.status !== 'SOLD' ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">${esc(getMarkClosedLabel(item))}</button>` : ''}
            ${showRequestActive ? `<button class="btn ghost" data-action="requestActive" data-id="${esc(item.id)}" type="button">Request Active</button>` : ''}
            ${quickDelete}
            ${requestPending ? `<span class="pill">Awaiting admin review</span>` : ''}
          </div>
        </div>
        <div class="topicSide ${isPictureBoard ? 'topicSide-gallery' : ''}">
          <div class="topicSideTop ${isPictureBoard ? 'topicSideTop-gallery' : ''}">
            <div class="price ${isPictureBoard ? 'galleryPriceTag' : ''}">${esc(visualValue)}</div>
            ${!isPictureBoard && item.imageUrl ? `<img class="topicThumb" src="${esc(item.imageUrl)}" alt="${esc(item.title)}" />` : ''}
          </div>
          ${sideMeta}
        </div>
      </article>
    `;
  }).join('');
  updateThreadNotificationUI();
}

async function handleSavePost() {
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before posting.');
    return;
  }

  if (isSavingPost) return;
  if (!currentUser || !currentProfile) {
    alert('Please log in first.');
    return;
  }
  if (!canCompleteMarketplaceLogin(currentProfile)) {
    alert('Your access is no longer active. Please log in again or contact an admin.');
    return;
  }

  const title = $('fTitle')?.value.trim();
  const description = $('fDesc')?.value.trim();
  const board = $('fBoard')?.value || 'BUYSELL';
  const status = $('fStatus')?.value || 'ACTIVE';
  const location = $('fLocation')?.value.trim() || '';
  const contact = $('fContact')?.value.trim() || '';
  const priceRaw = $('fPrice')?.value.trim() || '';
  const files = Array.from($('fPhoto')?.files || []);

  if (!title) {
    alert('Enter a title.');
    return;
  }
  if (!description) {
    alert('Enter a description.');
    return;
  }

  const moderationScan = detectModerationIssues([title, description, location, contact].join(' '));
  let imageUrl = '';
  let imageUrls = [];
  isSavingPost = true;
  if ($('btnSavePost')) $('btnSavePost').disabled = true;
  try {
    let existing = null;
    if (editingPostId) {
      existing = listings.find((x) => x.id === editingPostId) || null;
      if (!existing || !canModify(existing)) {
        alert('You do not have permission to edit this post.');
        return;
      }
      imageUrl = existing.imageUrl || existing.photo || '';
      imageUrls = getListingImageUrls(existing);
    }
    if (files.length) {
      const uploadedUrls = [];
      for (const [index, file] of files.entries()) {
        const safeName = `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
        await uploadBytes(storageRef, file);
        uploadedUrls.push(await getDownloadURL(storageRef));
      }
      imageUrls = uploadedUrls;
      imageUrl = uploadedUrls[0] || '';
    }

    if (board === 'PICTURES' && !imageUrls.length && !imageUrl) {
      alert('Please upload at least one photo for the Pictures board.');
      return;
    }

    const nowMs = Date.now();
    const payload = {
      category: board,
      board,
      status,
      title,
      desc: description,
      description,
      location,
      contact,
      price: Number(priceRaw || 0),
      photo: imageUrl,
      imageUrl,
      imageUrls,
      moderationFlagged: moderationScan.flagged,
      moderationLabels: moderationScan.matchedLabels,
      moderationMatchedTerms: moderationScan.matchedTerms,
      moderationSeverity: moderationScan.severity,
      moderationUpdatedAtMs: nowMs,
      updatedAt: serverTimestamp()
    };

    let listingId = editingPostId || '';
    if (editingPostId) {
      await updateDoc(doc(db, 'listings', editingPostId), payload);
    } else {
      const createdRef = await addDoc(collection(db, 'listings'), {
        uid: currentUser.uid,
        userEmail: currentUser.email || '',
        displayName: currentProfile.displayName || currentUser.email || '',
        authorName: currentProfile.displayName || currentUser.email || '',
        ...payload,
        replies: [],
        replyCount: 0,
        featured: false,
        hidden: false,
        reactivationRequested: false,
        createdAt: serverTimestamp(),
        createdAtMs: nowMs
      });
      listingId = createdRef.id;
    }

    void logMarketplaceActivity(editingPostId ? `Updated post: ${title}` : `Created post: ${title}`, {
      lastBoardVisited: board,
      currentView: 'POST',
      lastThreadId: listingId || '',
      lastThreadTitle: title
    }, { force: true });

    if (moderationScan.flagged && listingId && (!editingPostId || !existing?.moderationFlagged)) {
      await createModerationFlag({
        sourceType: 'listing',
        sourceKey: `listing:${listingId}`,
        listingId,
        listingTitle: title,
        userEmail: currentUser.email || '',
        displayName: currentProfile.displayName || currentUser.email || '',
        textSnippet: buildModerationSnippet(`${title} — ${description}`),
        matchedLabels: moderationScan.matchedLabels,
        matchedTerms: moderationScan.matchedTerms,
        severity: moderationScan.severity,
        createdByUid: currentUser.uid,
        createdByEmail: currentUser.email || ''
      });
    }

    resetPostEditor();
    hide('postOverlay');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'post_error'} — ${err?.message || 'Unable to save post.'}`);
  } finally {
    isSavingPost = false;
    if ($('btnSavePost')) $('btnSavePost').disabled = false;
  }
}

async function handleMarkSold(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;

  try {
    await updateDoc(doc(db, 'listings', id), {
      status: 'SOLD',
      reactivationRequested: false,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to update post.');
  }
}

async function handleRequestActive(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !currentUser || currentUser.uid !== item.uid) return;
  try {
    await updateDoc(doc(db, 'listings', id), {
      reactivationRequested: true,
      reactivationRequestedAt: Date.now(),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to request reactivation.');
  }
}

async function openThread(id) {
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before continuing.');
    return;
  }

  const item = listings.find((x) => x.id === id);
  if (!item) return;

  activeThread = item;
  startActiveThreadRepliesListener(item.id);
  if ($('threadTitle')) $('threadTitle').textContent = item.title || 'Thread';
  if ($('threadMeta')) {
    $('threadMeta').textContent = `${BOARD_DEFS.find((b) => b.key === item.board)?.label || item.board} | ${item.authorName || item.authorEmail || ''} | ${formatDate(item.createdAtMs)}`;
  }

  if ($('threadBody')) {
    const deleteThreadBtn = canModerate() ? `<button class="btn danger" data-action="deletePost" data-id="${esc(item.id)}" type="button">Delete Thread</button>` : '';
    const posterName = getPosterDisplayName(item);
    const posterContact = getPosterContactValue(item);
    $('threadBody').innerHTML = `
      <div class="thread-body-grid">
        <div class="threadPosterCard">
          <div class="threadPosterEyebrow">Thread owner</div>
          <div class="threadPosterName">${esc(posterName)}</div>
          <div class="threadPosterSub">Contact this person first about this thread.</div>
          ${posterContact ? `<div class="threadPosterContact"><span>Best contact</span><strong>${esc(posterContact)}</strong></div>` : ''}
        </div>
        ${String(item.board || '').toUpperCase() === 'PICTURES' ? buildThreadGallery(item) : (item.imageUrl ? `<img class="thread-card-image" src="${esc(item.imageUrl)}" alt="${esc(item.title)}" />` : '')}
        <div class="threadDescriptionCopy">${esc(item.description || '').replaceAll('\n', '<br>')}</div>
        <div class="topicMeta threadInfoList">
          <span>${esc(item.location || (String(item.board || '').toUpperCase() === 'PICTURES' ? 'Regal gallery' : 'No location'))}</span>
          <span>${esc(item.contact || 'No contact')}</span>
          <span>${esc(getListingDisplayValue(item))}</span>
        </div>
        ${deleteThreadBtn ? `<div class="rowBtns">${deleteThreadBtn}</div>` : ''}
      </div>
    `;
  }

  if ($('threadUnreadNotice')) {
    $('threadUnreadNotice').style.display = 'none';
  }
  if ($('threadMarkReadBtn')) {
    $('threadMarkReadBtn').dataset.id = item.id;
  }

  markThreadSeen(item.id, getListingLatestReplyMeta(item).latestMs || Date.now());
  renderReplies(mergedRepliesForThread(item));
  if ($('replyText')) $('replyText').value = '';
  show('threadOverlay');
  void logMarketplaceActivity(`Opened thread: ${item.title || 'Thread'}`, {
    lastBoardVisited: item.board || activeBoard || 'ALL',
    currentView: 'THREAD',
    lastThreadId: item.id || '',
    lastThreadTitle: item.title || ''
  }, { force: true });
}

function renderReplies(replies) {
  const wrap = $('threadReplies');
  if (!wrap) return;
  if ($('threadUnreadNotice')) {
    $('threadUnreadNotice').style.display = activeThread && hasUnreadThreadActivity(activeThread) ? 'block' : 'none';
  }
  if (!replies.length) {
    wrap.innerHTML = '<div class="note">No replies yet. Be the first to respond.</div>';
    return;
  }
  wrap.innerHTML = replies.map((r) => {
    const badges = [];
    if (canModerate() && r.flagged) badges.push('<span class="status pending">Flagged</span>');
    if (canModerate() && r.deleted) badges.push('<span class="status sold">Removed</span>');
    if (canModerate() && r.hidden && !r.deleted) badges.push('<span class="status">Hidden</span>');
    const bodyText = r.deleted ? 'Reply removed by moderation.' : (r.hidden ? 'Reply hidden by moderation.' : (r.text || ''));
    const deleteReplyBtn = canModerate() && !r.deleted
      ? `<button class="btn danger btn-xs" data-action="deleteReply" data-id="${esc(r.listingId || activeThread?.id || '')}" data-reply-key="${esc(r.sourceKey)}" type="button">Delete Reply</button>`
      : '';
    return `
      <div class="replyItem${r.flagged && canModerate() ? ' moderation-flagged' : ''}">
        <div class="replyTop">
          <div>
            <div class="replyUser">${esc(r.displayName || r.userEmail || 'Unknown')}</div>
            ${badges.length ? `<div class="replyBadges">${badges.join('')}</div>` : ''}
          </div>
          <div class="replyTime">${esc(formatDate(r.createdAtMs || r.createdAt))}</div>
        </div>
        <div>${esc(bodyText)}</div>
        ${deleteReplyBtn ? `<div class="rowBtns replyActionRow">${deleteReplyBtn}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function handleSendReply() {
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before replying.');
    return;
  }

  if (!currentUser || !currentProfile || !activeThread) {
    alert('Open a thread first.');
    return;
  }
  if (!canCompleteMarketplaceLogin(currentProfile)) {
    alert('Your access is no longer active. Please log in again or contact an admin.');
    return;
  }

  const text = $('replyText')?.value.trim();
  if (!text) {
    alert('Write a reply first.');
    return;
  }

  const listingRef = doc(db, 'listings', activeThread.id);
  const snap = await getDoc(listingRef);
  if (!snap.exists()) return;

  const moderationScan = detectModerationIssues(text);
  const createdAtMs = Date.now();

  try {
    const replyRef = await addDoc(collection(db, 'listings', activeThread.id, 'replies'), {
      listingId: activeThread.id,
      listingTitle: activeThread.title || '',
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      displayName: currentProfile.displayName || currentUser.email || '',
      text,
      textSnippet: buildModerationSnippet(text, 160),
      flagged: moderationScan.flagged,
      moderationLabels: moderationScan.matchedLabels,
      moderationMatchedTerms: moderationScan.matchedTerms,
      moderationSeverity: moderationScan.severity,
      hidden: false,
      deleted: false,
      createdAt: serverTimestamp(),
      createdAtMs,
      updatedAt: serverTimestamp()
    });

    await updateDoc(listingRef, {
      replyCount: increment(1),
      lastReplyAtMs: createdAtMs,
      lastReplyPreview: buildModerationSnippet(text, 120),
      lastReplyByUid: currentUser.uid,
      lastReplyByEmail: currentUser.email || '',
      updatedAt: serverTimestamp()
    }).catch(() => {});

    void logMarketplaceActivity(`Replied to: ${activeThread.title || 'Thread'}`, {
      lastBoardVisited: activeThread.board || activeBoard || 'ALL',
      currentView: 'THREAD',
      lastThreadId: activeThread.id || '',
      lastThreadTitle: activeThread.title || ''
    }, { force: true });

    if (moderationScan.flagged) {
      await createModerationFlag({
        sourceType: 'reply',
        sourceKey: `reply:${replyRef.id}`,
        listingId: activeThread.id,
        replyId: replyRef.id,
        listingTitle: activeThread.title || '',
        userEmail: currentUser.email || '',
        displayName: currentProfile.displayName || currentUser.email || '',
        textSnippet: buildModerationSnippet(text),
        matchedLabels: moderationScan.matchedLabels,
        matchedTerms: moderationScan.matchedTerms,
        severity: moderationScan.severity,
        createdByUid: currentUser.uid,
        createdByEmail: currentUser.email || ''
      });
    }

    markThreadSeen(activeThread.id, createdAtMs);
    if ($('replyText')) $('replyText').value = '';
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to send reply.');
  }
}

// --- CUSTOM WOW-FACTOR HERO SLIDER COMPONENT ---
class HeroSlider extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    let imgs = [];
    try {
      imgs = JSON.parse(this.getAttribute('images') || '[]');
    } catch (e) {}
    if (!imgs || imgs.length === 0) {
      imgs = ['Images/background1.jpg', 'Images/background2.jpg', 'Images/background3.jpg', 'Images/background4.jpg'];
    }
    this.images = imgs;
    this.currentIndex = 0;
  }

  connectedCallback() {
    this.render();
    this.startSlider();
  }

  render() {
    const style = `
      :host {
        display: block;
        position: fixed; /* Ensures it acts as a site-wide background */
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: -100; /* Deep behind all content */
        overflow: hidden;
        background-color: #0f172a; /* Deep premium backdrop */
      }
      
      .slide {
        position: absolute;
        inset: -5%; /* Slightly oversized to allow for safe zooming without exposing edges */
        background-size: cover;
        background-position: center;
        opacity: 0;
        transition: opacity 2.5s ease-in-out, transform 12s linear;
        transform: scale(1);
        z-index: 1;
      }
      
      .slide.active {
        opacity: 1;
        transform: scale(1.05); /* Smooth Ken Burns zoom effect */
        z-index: 2;
      }
      
      .noise-overlay {
        position: absolute;
        inset: 0;
        background-image: url('data:image/svg+xml,%3Csvg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noiseFilter"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noiseFilter)" opacity="0.08"/%3E%3C/svg%3E');
        z-index: 3;
        pointer-events: none;
      }
      
      .gradient-overlay {
        position: absolute;
        inset: 0;
        background: transparent;
        z-index: 4;
        pointer-events: none;
      }
    `;

    const slidesHTML = this.images.map((img, index) => 
      `<div class="slide ${index === 0 ? 'active' : ''}" style="background-image: url('${img}')"></div>`
    ).join('');

    this.shadowRoot.innerHTML = `
      <style>${style}</style>
      ${slidesHTML}
      <div class="noise-overlay"></div>
      <div class="gradient-overlay"></div>
    `;
  }

  startSlider() {
    if (this.images.length <= 1) return;
    
    setInterval(() => {
      const slides = this.shadowRoot.querySelectorAll('.slide');
      if (!slides.length) return;
      
      slides[this.currentIndex].classList.remove('active');
      this.currentIndex = (this.currentIndex + 1) % this.images.length;
      slides[this.currentIndex].classList.add('active');
    }, 6000); 
  }
}

customElements.define('hero-slider', HeroSlider);
