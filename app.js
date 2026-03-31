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
  { key: 'PICTURES', label: 'Pictures', desc: 'Curated employee photography gallery' },
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
let pictureStudioItems = [];
let pictureStudioDragId = '';
let pictureDesignerBlocks = [];
let pictureDesignerDragId = '';
let pictureDesignerEditingId = null;
let pictureDesignerResizeState = null;
let pictureDesignerToolsCollapsed = false;
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

  const openPost = (preferredBoardOverride = '') => {
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
    configurePostBoardOptions();
    const fallbackBoard = (activeBoard && activeBoard !== 'ALL') ? activeBoard : 'FREE';
    const preferredBoard = preferredBoardOverride || fallbackBoard;
    if ($('fBoard')) {
      $('fBoard').value = preferredBoard === 'PICTURES' && !canPostPicturesBoard() ? 'FREE' : preferredBoard;
    }
    refreshPhotoFieldHint();
    refreshPostComposerMode();
    show('postOverlay');
  };

  $('btnNew')?.addEventListener('click', () => {
    if (activeBoard === 'PICTURES' && canPostPicturesBoard()) {
      legacyOpenPicturesDesigner();
      return;
    }
    openPost(activeBoard === 'PICTURES' && !canPostPicturesBoard() ? 'FREE' : '');
  });
  $('heroPostBtn')?.addEventListener('click', () => openPost(activeBoard === 'PICTURES' ? 'FREE' : ''));
  $('heroPicturesBtn')?.addEventListener('click', () => legacyOpenPicturesDesigner());
  $('heroFreeBtn')?.addEventListener('click', () => {
    activeBoard = 'FREE';
    renderBoards();
    renderListings();
  });

  $('pictureStudioBrowseBtn')?.addEventListener('click', () => $('pictureDropInput')?.click());
  $('pictureDropZone')?.addEventListener('click', () => $('pictureDropInput')?.click());
  $('pictureStudioClearBtn')?.addEventListener('click', () => resetPictureStudioItems());
  $('pictureDropInput')?.addEventListener('change', (event) => {
    enqueuePictureStudioFiles(Array.from(event.target.files || []));
    event.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((eventName) => {
    $('pictureDropZone')?.addEventListener(eventName, (event) => {
      event.preventDefault();
      $('pictureDropZone')?.classList.add('is-dragover');
    });
  });
  ['dragleave', 'dragend'].forEach((eventName) => {
    $('pictureDropZone')?.addEventListener(eventName, () => $('pictureDropZone')?.classList.remove('is-dragover'));
  });
  $('pictureDropZone')?.addEventListener('drop', (event) => {
    event.preventDefault();
    $('pictureDropZone')?.classList.remove('is-dragover');
    enqueuePictureStudioFiles(Array.from(event.dataTransfer?.files || []));
  });

  $('studioAddPhotosBtn')?.addEventListener('click', () => $('studioImageInput')?.click());
  $('studioImageInput')?.addEventListener('change', (event) => {
    legacyAddFilesToPicturesDesigner(Array.from(event.target.files || []));
    event.target.value = '';
  });
  $('studioAddTextBtn')?.addEventListener('click', () => legacyAddTextBlockToPicturesDesigner());
  $('studioAddHeroTextBtn')?.addEventListener('click', () => legacyAddTextBlockToPicturesDesigner(null, 'hero'));
  $('studioClearBtn')?.addEventListener('click', () => legacyClearPicturesDesigner());
  $('studioCancelBtn')?.addEventListener('click', legacyClosePicturesDesigner);
  $('picturesDesignerCloseTop')?.addEventListener('click', legacyClosePicturesDesigner);
  $('picturesDesignerToggleTools')?.addEventListener('click', () => setPicturesDesignerToolsCollapsed(!pictureDesignerToolsCollapsed));
  $('picturesDesignerShowTools')?.addEventListener('click', () => setPicturesDesignerToolsCollapsed(false));
  $('studioSaveBtn')?.addEventListener('click', handleSavePicturesDesigner);
  $('picturesDesignerCanvas')?.addEventListener('dragover', (event) => {
    event.preventDefault();
    $('picturesDesignerCanvas')?.classList.add('is-dragover');
  });
  $('picturesDesignerCanvas')?.addEventListener('dragleave', () => $('picturesDesignerCanvas')?.classList.remove('is-dragover'));
  $('picturesDesignerCanvas')?.addEventListener('drop', (event) => {
    event.preventDefault();
    $('picturesDesignerCanvas')?.classList.remove('is-dragover');
    legacyAddFilesToPicturesDesigner(Array.from(event.dataTransfer?.files || []));
  });
  ['studioTitle', 'studioLocation', 'studioContact'].forEach((id) => {
    $(id)?.addEventListener('input', () => { legacyUpdatePicturesDesignerStatus(); legacyRenderPicturesDesigner(); });
  });
  document.addEventListener('pointermove', legacyHandlePicturesDesignerPointerMove);
  document.addEventListener('pointerup', legacyStopPicturesDesignerResize);

  $('btnSavePost')?.addEventListener('click', handleSavePost);
  $('btnSendReply')?.addEventListener('click', handleSendReply);

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => { const target = btn.dataset.close; if (target === 'postOverlay') resetPostEditor(); hide(target); });
  });

  document.querySelectorAll('.overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && ['postOverlay', 'threadOverlay', 'picturesDesignerOverlay'].includes(overlay.id)) {
        if (overlay.id === 'postOverlay') resetPostEditor();
        if (overlay.id === 'picturesDesignerOverlay') legacyClosePicturesDesigner();
        else hide(overlay.id);
      }
    });
  });

  $('q')?.addEventListener('input', renderListings);
  $('st')?.addEventListener('change', renderListings);
  $('sort')?.addEventListener('change', renderListings);
  $('fBoard')?.addEventListener('change', () => { refreshPhotoFieldHint(); refreshPostComposerMode(); });

  document.body.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const pictureId = actionEl.dataset.pictureId || '';
    if (action === 'pictureMoveLeft') {
      movePictureStudioItem(pictureId, 'left');
      return;
    }
    if (action === 'pictureMoveRight') {
      movePictureStudioItem(pictureId, 'right');
      return;
    }
    if (action === 'pictureRemove') {
      removePictureStudioItem(pictureId);
      return;
    }
    if (action === 'studioInsertText') {
      legacyAddTextBlockToPicturesDesigner(Number(actionEl.dataset.index || pictureDesignerBlocks.length));
      return;
    }
    if (action === 'studioInsertHeroText') {
      legacyAddTextBlockToPicturesDesigner(Number(actionEl.dataset.index || pictureDesignerBlocks.length), 'hero');
      return;
    }
    if (action === 'studioRemoveBlock') {
      relegacyMovePicturesDesignerBlock(actionEl.dataset.blockId || '');
      return;
    }
    if (action === 'studioMoveBlockUp') {
      legacyMovePicturesDesignerBlock(actionEl.dataset.blockId || '', 'up');
      return;
    }
    if (action === 'studioMoveBlockDown') {
      legacyMovePicturesDesignerBlock(actionEl.dataset.blockId || '', 'down');
      return;
    }
    if (action === 'studioDuplicateBlock') {
      legacyDuplicatePicturesDesignerBlock(actionEl.dataset.blockId || '');
      return;
    }
    if (action === 'studioSetSize') {
      legacyUpdatePicturesDesignerBlock(actionEl.dataset.blockId || '', { size: normalizeStudioBlockSize(actionEl.dataset.size || '', actionEl.dataset.blockType || 'image') });
      return;
    }
    if (action === 'studioSetAlign') {
      legacyUpdatePicturesDesignerBlock(actionEl.dataset.blockId || '', { align: normalizeStudioBlockAlign(actionEl.dataset.align || 'center') });
      return;
    }

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

  document.body.addEventListener('input', (e) => {
    const studioField = e.target.closest('[data-studio-field]');
    if (!studioField) return;
    const blockId = studioField.dataset.blockId || '';
    const field = studioField.dataset.studioField || '';
    if (!blockId || !field) return;
    legacyUpdatePicturesDesignerBlock(blockId, { [field]: studioField.value }, { render: false });
  });

  document.body.addEventListener('change', (e) => {
    const studioStyleSelect = e.target.closest('[data-studio-style]');
    if (studioStyleSelect) {
      const blockId = studioStyleSelect.dataset.blockId || '';
      legacyUpdatePicturesDesignerBlock(blockId, { style: studioStyleSelect.value || 'body' });
      return;
    }
    const layoutSelect = e.target.closest('[data-picture-layout]');
    if (!layoutSelect) return;
    const pictureId = layoutSelect.dataset.pictureLayout || '';
    const target = pictureStudioItems.find((item) => item.id === pictureId);
    if (!target) return;
    target.layout = normalizePictureLayout(layoutSelect.value);
  });

  syncHeroComposerButtons();
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
  if (el) el.style.display = id === 'picturesDesignerOverlay' ? 'block' : 'flex';
  if (id === 'picturesDesignerOverlay') {
    document.body.classList.add('studio-open');
    return;
  }
  if (id !== 'loginOverlay') document.body.classList.add('modal-open');
}

function hide(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
  if (id === 'picturesDesignerOverlay') {
    document.body.classList.remove('studio-open');
    return;
  }
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

const PICTURES_CURATORS = new Set([
  'ariel.r@regallakeland.com'
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

function canPostPicturesBoard() {
  return !!currentUser && (canModerate() || PICTURES_CURATORS.has(normalizeEmail(currentUser?.email)));
}

function normalizePictureLayout(value) {
  const layout = String(value || '').toLowerCase();
  if (['hero', 'wide', 'tall'].includes(layout)) return layout;
  return 'standard';
}

function releasePictureStudioItem(item) {
  if (item?.previewUrl && item?.previewObjectUrl) {
    try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
  }
}

function createPictureStudioItem({ file = null, url = '', name = '', layout = 'standard' } = {}) {
  const previewUrl = url || (file ? URL.createObjectURL(file) : '');
  return {
    id: `pic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    sourceUrl: url || '',
    previewUrl,
    previewObjectUrl: !url && !!file,
    name: name || file?.name || 'Photo',
    layout: normalizePictureLayout(layout)
  };
}

function resetPictureStudioItems() {
  pictureStudioItems.forEach(releasePictureStudioItem);
  pictureStudioItems = [];
  pictureStudioDragId = '';
  renderPictureStudioList();
}

function enqueuePictureStudioFiles(files = []) {
  const incoming = Array.from(files || []).filter((file) => String(file?.type || '').startsWith('image/'));
  if (!incoming.length) return;
  const next = incoming.map((file) => createPictureStudioItem({ file }));
  pictureStudioItems = [...pictureStudioItems, ...next];
  renderPictureStudioList();
}

function setPictureStudioItems(items = []) {
  resetPictureStudioItems();
  pictureStudioItems = items.map((item) => createPictureStudioItem(item));
  renderPictureStudioList();
}

function movePictureStudioItem(itemId, direction) {
  const index = pictureStudioItems.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const swapIndex = direction === 'left' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= pictureStudioItems.length) return;
  const clone = pictureStudioItems.slice();
  [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  pictureStudioItems = clone;
  renderPictureStudioList();
}

function reorderPictureStudioItems(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const fromIndex = pictureStudioItems.findIndex((item) => item.id === fromId);
  const toIndex = pictureStudioItems.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const clone = pictureStudioItems.slice();
  const [moved] = clone.splice(fromIndex, 1);
  clone.splice(toIndex, 0, moved);
  pictureStudioItems = clone;
  renderPictureStudioList();
}

function removePictureStudioItem(itemId) {
  const target = pictureStudioItems.find((item) => item.id === itemId);
  if (!target) return;
  releasePictureStudioItem(target);
  pictureStudioItems = pictureStudioItems.filter((item) => item.id !== itemId);
  renderPictureStudioList();
}

function attachPictureStudioDragHandlers() {
  const cards = document.querySelectorAll('.pictureStudioItem');
  cards.forEach((card) => {
    card.addEventListener('dragstart', () => {
      pictureStudioDragId = card.dataset.pictureId || '';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      pictureStudioDragId = '';
      cards.forEach((entry) => entry.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetId = card.dataset.pictureId || '';
      card.classList.remove('drag-over');
      reorderPictureStudioItems(pictureStudioDragId, targetId);
    });
  });
}

function renderPictureStudioList() {
  const wrap = $('pictureStudioList');
  const count = $('pictureStudioCount');
  if (count) {
    count.textContent = `${pictureStudioItems.length} photo${pictureStudioItems.length === 1 ? '' : 's'} ready`;
  }
  if (!wrap) return;
  if (!pictureStudioItems.length) {
    wrap.innerHTML = '<div class="pictureStudioEmpty">Drop images here to build the gallery. You can drag cards to reorder them after upload.</div>';
    return;
  }
  wrap.innerHTML = pictureStudioItems.map((item, index) => `
    <article class="pictureStudioItem" data-picture-id="${esc(item.id)}" draggable="true">
      <div class="pictureStudioItemMedia">
        <img src="${esc(item.previewUrl)}" alt="${esc(item.name)}" loading="lazy" />
        <span class="pictureStudioBadge">${index === 0 ? 'Cover' : `#${index + 1}`}</span>
      </div>
      <div class="pictureStudioItemBody">
        <div class="pictureStudioItemTop">
          <strong>${esc(item.name)}</strong>
          <span>Drag to reorder</span>
        </div>
        <div class="pictureStudioControls">
          <label>Display size</label>
          <select data-picture-layout="${esc(item.id)}">
            <option value="standard" ${item.layout === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="wide" ${item.layout === 'wide' ? 'selected' : ''}>Wide</option>
            <option value="tall" ${item.layout === 'tall' ? 'selected' : ''}>Tall</option>
            <option value="hero" ${item.layout === 'hero' ? 'selected' : ''}>Hero</option>
          </select>
        </div>
        <div class="rowBtns pictureStudioItemActions">
          <button class="btn ghost" data-action="pictureMoveLeft" data-picture-id="${esc(item.id)}" type="button">Move Left</button>
          <button class="btn ghost" data-action="pictureMoveRight" data-picture-id="${esc(item.id)}" type="button">Move Right</button>
          <button class="btn danger" data-action="pictureRemove" data-picture-id="${esc(item.id)}" type="button">Remove</button>
        </div>
      </div>
    </article>
  `).join('\n\n');
  attachPictureStudioDragHandlers();
}

function setFieldMode(inputId, visible, { label = '', placeholder = '', disabled = false } = {}) {
  const input = $(inputId);
  if (!input) return;
  const field = input.closest('.field');
  if (field) field.style.display = visible ? '' : 'none';
  if (label && field?.querySelector('label')) field.querySelector('label').textContent = label;
  if (placeholder) input.placeholder = placeholder;
  input.disabled = !!disabled;
}

function refreshPostComposerMode() {
  const board = $('fBoard')?.value || 'FREE';
  const pictureMode = board === 'PICTURES';
  if (pictureMode) {
    alert('Use the Pictures Studio to publish gallery posts.');
    hide('postOverlay');
    legacyOpenPicturesDesigner(editingPostId || null);
    return;
  }
  const overlayModal = $('postOverlay')?.querySelector('.modal');
  overlayModal?.classList.toggle('pictureStudioMode', pictureMode);
  const titleEl = $('postOverlay')?.querySelector('.modal-h strong');
  const isEditing = !!editingPostId;
  if (titleEl) titleEl.textContent = pictureMode ? (isEditing ? 'Edit Picture Gallery' : 'Create Picture Gallery') : (isEditing ? 'Edit Post' : 'Create Post');
  if ($('btnSavePost')) $('btnSavePost').textContent = pictureMode ? (isEditing ? 'Save Gallery' : 'Publish Gallery') : (isEditing ? 'Save Changes' : 'Post Listing');
  if ($('pictureStudioShell')) $('pictureStudioShell').style.display = pictureMode ? 'grid' : 'none';

  setFieldMode('fStatus', !pictureMode, { label: 'Status' });
  setFieldMode('fPrice', !pictureMode, { label: 'Price (optional)', placeholder: '0 for free, 25, 100…' });
  setFieldMode('fDesc', !pictureMode, { label: 'Description', placeholder: 'Condition, pickup window, details…' });
  setFieldMode('fPhoto', !pictureMode, { label: 'Photos (optional)' });
  setFieldMode('fTitle', true, { label: pictureMode ? 'Gallery title (optional)' : 'Title', placeholder: pictureMode ? 'Employee appreciation lunch • New inventory shoot…' : 'e.g. Free couch • Garage sale Saturday…' });
  setFieldMode('fLocation', true, { label: pictureMode ? 'Event / location (optional)' : 'Location (optional)', placeholder: pictureMode ? 'Regal Honda showroom • Lakeland • March 2026' : 'Lakeland, Plant City…' });
  setFieldMode('fContact', true, { label: pictureMode ? 'Photographer credit / contact (optional)' : 'Contact person name / details (optional)', placeholder: pictureMode ? 'Ariel Restituyo Garcia • Regal Lakeland' : 'Contact name | text/call/email or where to find you at work' });

  const boardSelect = $('fBoard');
  if (boardSelect) boardSelect.disabled = false;
}

function hydratePictureStudioFromListing(item) {
  const urls = getListingImageUrls(item);
  const layouts = Array.isArray(item?.imageLayouts) ? item.imageLayouts : [];
  if (!urls.length) {
    resetPictureStudioItems();
    return;
  }
  setPictureStudioItems(urls.map((url, index) => ({
    url,
    name: `${item?.title || 'Gallery'} ${index + 1}`,
    layout: layouts[index] || 'standard'
  })));
}

function syncHeroComposerButtons() {
  const heroPostBtn = $('heroPostBtn');
  const heroPicturesBtn = $('heroPicturesBtn');
  const onPicturesBoard = activeBoard === 'PICTURES';
  if (heroPostBtn) heroPostBtn.style.display = onPicturesBoard ? 'none' : '';
  if (heroPicturesBtn) {
    heroPicturesBtn.style.display = onPicturesBoard && canPostPicturesBoard() ? '' : 'none';
    heroPicturesBtn.textContent = 'Open Pictures Studio';
  }
}

function studioBlockId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeStudioBlockSize(value, type = 'image') {
  const clean = String(value || '').toLowerCase();
  if (type === 'text') {
    if (['column', 'wide', 'hero'].includes(clean)) return clean;
    return 'wide';
  }
  if (['standard', 'wide', 'hero'].includes(clean)) return clean;
  return 'wide';
}

function normalizeStudioBlockHeight(value) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return 280;
  return Math.min(640, Math.max(180, Math.round(next)));
}

function normalizeStudioBlockAlign(value) {
  const clean = String(value || '').toLowerCase();
  if (['left', 'center', 'right'].includes(clean)) return clean;
  return 'center';
}

function setPicturesDesignerToolsCollapsed(collapsed) {
  pictureDesignerToolsCollapsed = !!collapsed;
  const overlay = $('picturesDesignerOverlay');
  if (overlay) overlay.classList.toggle('tools-collapsed', pictureDesignerToolsCollapsed);
  const toggleBtn = $('picturesDesignerToggleTools');
  if (toggleBtn) toggleBtn.textContent = pictureDesignerToolsCollapsed ? 'Show Tools' : 'Hide Tools';
  const showBtn = $('picturesDesignerShowTools');
  if (showBtn) showBtn.style.display = pictureDesignerToolsCollapsed ? 'inline-flex' : 'none';
}

function studioSizeToLegacyLayout(size) {
  if (size === 'hero') return 'hero';
  if (size === 'wide') return 'wide';
  return 'standard';
}

function legacyLayoutToStudioSize(layout) {
  if (layout === 'hero') return 'hero';
  if (layout === 'wide' || layout === 'tall') return 'wide';
  return 'standard';
}

function legacyCreatePicturesDesignerImageBlock({ file = null, url = '', caption = '', size = 'wide', align = 'center', height = 280, name = '' } = {}) {
  const previewUrl = file ? URL.createObjectURL(file) : String(url || '');
  return {
    id: studioBlockId(),
    type: 'image',
    file,
    previewUrl,
    sourceUrl: String(url || ''),
    caption: String(caption || ''),
    size: normalizeStudioBlockSize(size, 'image'),
    align: normalizeStudioBlockAlign(align),
    height: normalizeStudioBlockHeight(height),
    name: String(name || (file?.name || 'Photo'))
  };
}

function legacyCreatePicturesDesignerTextBlock({ heading = '', text = '', size = 'wide', align = 'center', style = 'body' } = {}) {
  return {
    id: studioBlockId(),
    type: 'text',
    heading: String(heading || ''),
    text: String(text || ''),
    size: normalizeStudioBlockSize(size, 'text'),
    align: normalizeStudioBlockAlign(align),
    style: ['body', 'hero', 'note'].includes(String(style || '').toLowerCase()) ? String(style || '').toLowerCase() : 'body'
  };
}

function releasePicturesDesignerBlock(block) {
  if (block?.type === 'image' && block?.file && block?.previewUrl) {
    try { URL.revokeObjectURL(block.previewUrl); } catch {}
  }
}

function legacyClearPicturesDesigner(silent = false) {
  if (!silent && pictureDesignerBlocks.length && !confirm('Clear the current gallery canvas?')) return;
  pictureDesignerBlocks.forEach(releasePicturesDesignerBlock);
  pictureDesignerBlocks = [];
  pictureDesignerDragId = '';
  pictureDesignerResizeState = null;
  legacyRenderPicturesDesigner();
}

function legacyResetPicturesDesigner() {
  legacyClearPicturesDesigner(true);
  pictureDesignerEditingId = null;
  if ($('studioTitle')) $('studioTitle').value = '';
  if ($('studioLocation')) $('studioLocation').value = '';
  if ($('studioContact')) $('studioContact').value = '';
  legacyUpdatePicturesDesignerStatus();
}

function legacyUpdatePicturesDesignerStatus() {
  const statusEl = $('studioStatusLine');
  if (!statusEl) return;
  const imageCount = pictureDesignerBlocks.filter((block) => block.type === 'image').length;
  const textCount = pictureDesignerBlocks.filter((block) => block.type === 'text').length;
  const title = $('studioTitle')?.value.trim() || (pictureDesignerEditingId ? 'Editing gallery' : 'New gallery');
  statusEl.textContent = `${title} • ${imageCount} photo${imageCount === 1 ? '' : 's'} • ${textCount} text block${textCount === 1 ? '' : 's'}`;
}

function setPicturesDesignerBlocks(nextBlocks) {
  pictureDesignerBlocks.forEach(releasePicturesDesignerBlock);
  pictureDesignerBlocks = nextBlocks;
  legacyRenderPicturesDesigner();
}

function insertPicturesDesignerBlocks(newBlocks, insertIndex = null) {
  const blocks = Array.isArray(newBlocks) ? newBlocks.filter(Boolean) : [newBlocks].filter(Boolean);
  if (!blocks.length) return;
  if (insertIndex === null || insertIndex === undefined || insertIndex < 0 || insertIndex > pictureDesignerBlocks.length) {
    pictureDesignerBlocks = [...pictureDesignerBlocks, ...blocks];
  } else {
    pictureDesignerBlocks = [
      ...pictureDesignerBlocks.slice(0, insertIndex),
      ...blocks,
      ...pictureDesignerBlocks.slice(insertIndex)
    ];
  }
  legacyRenderPicturesDesigner();
}

function legacyAddFilesToPicturesDesigner(files, insertIndex = null) {
  const images = (files || []).filter((file) => file && String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  insertPicturesDesignerBlocks(images.map((file) => legacyCreatePicturesDesignerImageBlock({ file })), insertIndex);
}

function legacyAddTextBlockToPicturesDesigner(insertIndex = null, style = 'body') {
  insertPicturesDesignerBlocks(legacyCreatePicturesDesignerTextBlock({ style, size: style === 'hero' ? 'hero' : 'wide' }), insertIndex);
}

function relegacyRenderPicturesDesignerPreserveScroll() {
  const overlay = $('picturesDesignerOverlay');
  const top = overlay ? overlay.scrollTop : window.scrollY;
  legacyRenderPicturesDesigner();
  if (overlay) overlay.scrollTop = top;
  else window.scrollTo({ top });
}

function legacyUpdatePicturesDesignerBlock(blockId, patch = {}, options = {}) {
  const shouldRender = options.render !== false;
  pictureDesignerBlocks = pictureDesignerBlocks.map((block) => {
    if (block.id !== blockId) return block;
    const next = { ...block, ...patch };
    if (next.type === 'image') {
      next.size = normalizeStudioBlockSize(next.size, 'image');
      next.align = normalizeStudioBlockAlign(next.align);
      next.height = normalizeStudioBlockHeight(next.height);
      next.caption = String(next.caption || '');
    } else {
      next.size = normalizeStudioBlockSize(next.size, 'text');
      next.align = normalizeStudioBlockAlign(next.align);
      next.heading = String(next.heading || '');
      next.text = String(next.text || '');
      next.style = ['body', 'hero', 'note'].includes(String(next.style || '').toLowerCase()) ? String(next.style || '').toLowerCase() : 'body';
    }
    return next;
  });
  legacyUpdatePicturesDesignerStatus();
  if (shouldRender) relegacyRenderPicturesDesignerPreserveScroll();
}

function legacyMovePicturesDesignerBlock(blockId, direction = 'down') {
  const index = pictureDesignerBlocks.findIndex((block) => block.id === blockId);
  if (index < 0) return;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= pictureDesignerBlocks.length) return;
  const clone = pictureDesignerBlocks.slice();
  [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  pictureDesignerBlocks = clone;
  legacyRenderPicturesDesigner();
}

function legacyReorderPicturesDesignerBlocks(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const fromIndex = pictureDesignerBlocks.findIndex((block) => block.id === fromId);
  const toIndex = pictureDesignerBlocks.findIndex((block) => block.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const clone = pictureDesignerBlocks.slice();
  const [moved] = clone.splice(fromIndex, 1);
  clone.splice(toIndex, 0, moved);
  pictureDesignerBlocks = clone;
  legacyRenderPicturesDesigner();
}

function relegacyMovePicturesDesignerBlock(blockId) {
  const target = pictureDesignerBlocks.find((block) => block.id === blockId);
  if (target) releasePicturesDesignerBlock(target);
  pictureDesignerBlocks = pictureDesignerBlocks.filter((block) => block.id !== blockId);
  legacyRenderPicturesDesigner();
}

function legacyDuplicatePicturesDesignerBlock(blockId) {
  const target = pictureDesignerBlocks.find((block) => block.id === blockId);
  if (!target) return;
  const clone = target.type === 'image'
    ? legacyCreatePicturesDesignerImageBlock({ url: target.sourceUrl || target.previewUrl, caption: target.caption, size: target.size, align: target.align, height: target.height, name: target.name })
    : legacyCreatePicturesDesignerTextBlock({ heading: target.heading, text: target.text, size: target.size, align: target.align, style: target.style });
  const idx = pictureDesignerBlocks.findIndex((block) => block.id === blockId);
  insertPicturesDesignerBlocks(clone, idx + 1);
}

function bindPicturesDesignerDrag() {
  document.querySelectorAll('.studioCanvasBlock').forEach((card) => {
    card.draggable = true;
    card.ondragstart = (event) => {
      const target = event.target;
      if (target?.closest('button, input, textarea, select, option, label, .studioResizeHandle, .studioBlockField')) {
        event.preventDefault();
        return false;
      }
      if (!target?.closest('.studioBlockToolbar, .studioBlockLabel')) {
        event.preventDefault();
        return false;
      }
      pictureDesignerDragId = card.dataset.blockId || '';
      card.classList.add('is-dragging');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      return true;
    };
    card.ondragend = () => {
      pictureDesignerDragId = '';
      card.classList.remove('is-dragging');
      document.querySelectorAll('.studioCanvasBlock').forEach((node) => node.classList.remove('is-over'));
    };
    card.ondragover = (event) => {
      event.preventDefault();
      card.classList.add('is-over');
    };
    card.ondragleave = () => card.classList.remove('is-over');
    card.ondrop = (event) => {
      event.preventDefault();
      card.classList.remove('is-over');
      legacyReorderPicturesDesignerBlocks(pictureDesignerDragId, card.dataset.blockId || '');
    };
  });
  document.querySelectorAll('.studioCanvasBlock button, .studioCanvasBlock input, .studioCanvasBlock textarea, .studioCanvasBlock select').forEach((el) => {
    el.draggable = false;
    el.onmousedown = (event) => event.stopPropagation();
  });
  document.querySelectorAll('.studioResizeHandle').forEach((handle) => {
    handle.draggable = false;
    handle.onmousedown = (event) => event.stopPropagation();
    handle.onpointerdown = (event) => {
      event.stopPropagation();
      startPicturesDesignerResize(event, handle.dataset.blockId || '');
    };
  });
}

function startPicturesDesignerResize(event, blockId) {
  const block = pictureDesignerBlocks.find((entry) => entry.id === blockId && entry.type === 'image');
  if (!block) return;
  event.preventDefault();
  pictureDesignerResizeState = {
    blockId,
    startY: event.clientY,
    startHeight: normalizeStudioBlockHeight(block.height)
  };
  document.body.classList.add('studio-resizing');
}

function legacyHandlePicturesDesignerPointerMove(event) {
  if (!pictureDesignerResizeState) return;
  const nextHeight = normalizeStudioBlockHeight(pictureDesignerResizeState.startHeight + (event.clientY - pictureDesignerResizeState.startY));
  const block = pictureDesignerBlocks.find((entry) => entry.id === pictureDesignerResizeState.blockId);
  if (!block) return;
  block.height = nextHeight;
  const stage = document.querySelector(`.studioCanvasBlock[data-block-id="${pictureDesignerResizeState.blockId}"] .studioBlockImageStage`);
  if (stage) stage.style.setProperty('--studio-image-height', `${nextHeight}px`);
}

function legacyStopPicturesDesignerResize() {
  if (!pictureDesignerResizeState) return;
  pictureDesignerResizeState = null;
  document.body.classList.remove('studio-resizing');
  legacyRenderPicturesDesigner();
}

function legacyRenderPicturesDesigner() {
  const canvas = $('picturesDesignerCanvas');
  if (!canvas) return;
  if (!pictureDesignerBlocks.length) {
    canvas.innerHTML = `
      <div class="studioEmptyState">
        <div class="studioEmptyIcon">🖼️</div>
        <strong>Start building the gallery</strong>
        <span>Add images or text blocks to begin.</span>
      </div>
      <div class="studioCanvasInsertShell">
        <button class="studioInsertBar" data-action="studioInsertText" data-index="0" type="button">+ Add text anywhere</button>
      </div>
    `;
    legacyUpdatePicturesDesignerStatus();
    return;
  }
  const metaHeader = `
    <div class="studioPreviewHeader">
      <div>
        <div class="studioPreviewEyebrow">Picture Gallery Preview</div>
        <h2>${esc($('studioTitle')?.value.trim() || 'Untitled gallery')}</h2>
        <div class="studioPreviewMeta">
          <span>${esc($('studioLocation')?.value.trim() || 'Regal Lakeland')}</span>
          <span>${esc($('studioContact')?.value.trim() || 'Photographer credit')}</span>
        </div>
      </div>
    </div>
  `;
  const blockHtml = pictureDesignerBlocks.map((block, index) => {
    const sizeButtons = block.type === 'image'
      ? `
        <div class="studioControlRow">
          <div class="studioSizeButtons">
            ${['standard', 'wide', 'hero'].map((size) => `<button class="studioSizeBtn ${block.size === size ? 'active' : ''}" data-action="studioSetSize" data-block-id="${esc(block.id)}" data-block-type="image" data-size="${size}" type="button">${esc(size)}</button>`).join('')}
          </div>
          <div class="studioAlignButtons">
            ${['left', 'center', 'right'].map((align) => `<button class="studioAlignBtn ${normalizeStudioBlockAlign(block.align) === align ? 'active' : ''}" data-action="studioSetAlign" data-block-id="${esc(block.id)}" data-align="${align}" type="button">${esc(align)}</button>`).join('')}
          </div>
        </div>
      `
      : `
        <div class="studioControlRow">
          <div class="studioSizeButtons">
            ${['column', 'wide', 'hero'].map((size) => `<button class="studioSizeBtn ${block.size === size ? 'active' : ''}" data-action="studioSetSize" data-block-id="${esc(block.id)}" data-block-type="text" data-size="${size}" type="button">${esc(size)}</button>`).join('')}
          </div>
          <div class="studioAlignButtons">
            ${['left', 'center', 'right'].map((align) => `<button class="studioAlignBtn ${normalizeStudioBlockAlign(block.align) === align ? 'active' : ''}" data-action="studioSetAlign" data-block-id="${esc(block.id)}" data-align="${align}" type="button">${esc(align)}</button>`).join('')}
          </div>
        </div>
      `;
    const insertAbove = `<button class="studioInsertBar studioInsertBar-inline" data-action="studioInsertText" data-index="${index}" type="button">+ Text above</button>`;
    const insertBelow = `<button class="studioInsertBar studioInsertBar-inline" data-action="studioInsertText" data-index="${index + 1}" type="button">+ Text below</button>`;
    if (block.type === 'image') {
      return `
        <div class="studioCanvasInsertShell">${insertAbove}</div>
        <article class="studioCanvasBlock studioCanvasBlock-image studioSize-${esc(block.size)} studioAlign-${esc(normalizeStudioBlockAlign(block.align))}" data-block-id="${esc(block.id)}">
          <div class="studioBlockToolbar">
            <span class="studioBlockLabel">Image block</span>
            <div class="studioBlockActions rowBtns">
              <button class="btn ghost btn-xs" data-action="studioMoveBlockUp" data-block-id="${esc(block.id)}" type="button">Up</button>
              <button class="btn ghost btn-xs" data-action="studioMoveBlockDown" data-block-id="${esc(block.id)}" type="button">Down</button>
              <button class="btn ghost btn-xs" data-action="studioDuplicateBlock" data-block-id="${esc(block.id)}" type="button">Duplicate</button>
              <button class="btn danger btn-xs" data-action="studioRemoveBlock" data-block-id="${esc(block.id)}" type="button">Remove</button>
            </div>
          </div>
          <div class="studioBlockImageStage" style="--studio-image-height:${normalizeStudioBlockHeight(block.height)}px">
            <img src="${esc(block.previewUrl || block.sourceUrl)}" alt="${esc(block.name || 'Gallery image')}" loading="lazy" />
            <button class="studioResizeHandle" data-block-id="${esc(block.id)}" type="button" aria-label="Resize image"></button>
          </div>
          ${sizeButtons}
          <div class="field studioBlockField">
            <label>Caption under image</label>
            <input data-studio-field="caption" data-block-id="${esc(block.id)}" value="${esc(block.caption || '')}" placeholder="Write a caption for this image" />
          </div>
        </article>
        <div class="studioCanvasInsertShell">${insertBelow}</div>
      `;
    }
    return `
      <div class="studioCanvasInsertShell">${insertAbove}</div>
      <article class="studioCanvasBlock studioCanvasBlock-text studioTextSize-${esc(block.size)} studioTextStyle-${esc(block.style || 'body')} studioAlign-${esc(normalizeStudioBlockAlign(block.align))}" data-block-id="${esc(block.id)}">
        <div class="studioBlockToolbar">
          <span class="studioBlockLabel">Text block</span>
          <div class="studioBlockActions rowBtns">
            <button class="btn ghost btn-xs" data-action="studioMoveBlockUp" data-block-id="${esc(block.id)}" type="button">Up</button>
            <button class="btn ghost btn-xs" data-action="studioMoveBlockDown" data-block-id="${esc(block.id)}" type="button">Down</button>
            <button class="btn ghost btn-xs" data-action="studioDuplicateBlock" data-block-id="${esc(block.id)}" type="button">Duplicate</button>
            <button class="btn danger btn-xs" data-action="studioRemoveBlock" data-block-id="${esc(block.id)}" type="button">Remove</button>
          </div>
        </div>
        ${sizeButtons}
        <div class="grid2 studioTextControls">
          <div class="field studioBlockField">
            <label>Heading (optional)</label>
            <input data-studio-field="heading" data-block-id="${esc(block.id)}" value="${esc(block.heading || '')}" placeholder="Section heading" />
          </div>
          <div class="field studioBlockField">
            <label>Style</label>
            <select data-studio-style="true" data-block-id="${esc(block.id)}">
              <option value="body" ${block.style === 'body' ? 'selected' : ''}>Body</option>
              <option value="hero" ${block.style === 'hero' ? 'selected' : ''}>Hero</option>
              <option value="note" ${block.style === 'note' ? 'selected' : ''}>Note</option>
            </select>
          </div>
        </div>
        <div class="field studioBlockField">
          <label>Text</label>
          <textarea data-studio-field="text" data-block-id="${esc(block.id)}" rows="5" placeholder="Write a caption section, event story, quote, or announcement...">${esc(block.text || '')}</textarea>
        </div>
      </article>
      <div class="studioCanvasInsertShell">${insertBelow}</div>
    `;
  }).join('');
  canvas.innerHTML = metaHeader + blockHtml;
  bindPicturesDesignerDrag();
  legacyUpdatePicturesDesignerStatus();
}

function legacyOpenPicturesDesigner(postId = null) {
  if (!currentUser) {
    alert('Please log in first.');
    return;
  }
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before using the Pictures Studio.');
    return;
  }
  if (!canPostPicturesBoard()) {
    alert('Only approved gallery managers can use the Pictures Studio.');
    return;
  }
  legacyResetPicturesDesigner();
  if (postId) {
    const item = listings.find((entry) => entry.id === postId);
    if (!item || !canModify(item)) {
      alert('You do not have permission to edit this gallery.');
      return;
    }
    pictureDesignerEditingId = postId;
    if ($('studioTitle')) $('studioTitle').value = item.title || '';
    if ($('studioLocation')) $('studioLocation').value = item.location || '';
    if ($('studioContact')) $('studioContact').value = item.contact || '';
    const blocks = getPictureGalleryBlocks(item).map((block) => block.type === 'image'
      ? legacyCreatePicturesDesignerImageBlock({ url: block.url, caption: block.caption || '', size: block.size || legacyLayoutToStudioSize(block.layout), align: block.align || 'center', height: block.height || 280, name: block.name || item.title || 'Photo' })
      : legacyCreatePicturesDesignerTextBlock({ heading: block.heading || '', text: block.text || '', size: block.size || 'wide', align: block.align || 'center', style: block.style || 'body' }));
    pictureDesignerBlocks = blocks;
  }
  legacyRenderPicturesDesigner();
  legacyUpdatePicturesDesignerStatus();
  setPicturesDesignerToolsCollapsed(false);
  show('picturesDesignerOverlay');
}

function legacyClosePicturesDesigner() {
  hide('picturesDesignerOverlay');
  setPicturesDesignerToolsCollapsed(false);
  legacyResetPicturesDesigner();
}

function configurePostBoardOptions() {
  const boardSelect = $('fBoard');
  if (!boardSelect) return;
  const picturesOption = Array.from(boardSelect.options).find((opt) => opt.value === 'PICTURES');
  if (picturesOption) {
    const allowed = false;
    picturesOption.disabled = !allowed;
    picturesOption.hidden = true;
    if (!allowed && boardSelect.value === 'PICTURES') boardSelect.value = 'FREE';
  }
  refreshPhotoFieldHint();
  refreshPostComposerMode();
  syncHeroComposerButtons();
}

function refreshPhotoFieldHint() {
  const hint = $('photoFieldHint');
  if (!hint) return;
  const board = $('fBoard')?.value || 'FREE';
  if (board === 'PICTURES') {
    hint.textContent = canPostPicturesBoard()
      ? 'Pictures uses the dedicated Pictures Studio for gallery design.'
      : 'Pictures is a curated gallery board managed by admins, moderators, and Ariel Restituyo Garcia.';
    return;
  }
  hint.textContent = 'Normal posts stay compact in the feed with a standard preview image. Open the thread to view the full photo.';
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
  configurePostBoardOptions();

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

function boardCounts() {
  const visible = listings.filter((item) => isVisibleToViewer(item));
  const counts = { ALL: visible.length };
  BOARD_DEFS.forEach((b) => { if (b.key !== 'ALL') counts[b.key] = 0; });
  visible.forEach((item) => { counts[item.board] = (counts[item.board] || 0) + 1; });
  return counts;
}


function latestForBoard(boardKey) {
  const list = listings.filter((item) => isVisibleToViewer(item) && (boardKey === 'ALL' || item.board === boardKey));
  return list[0] || null;
}


function renderBoards() {
  const wrap = $('boards');
  if (!wrap) return;

  const counts = boardCounts();
  wrap.innerHTML = BOARD_DEFS.map((board) => {
    const last = latestForBoard(board.key);
    return `
      <button class="boardBtn ${activeBoard === board.key ? 'active' : ''}" data-board="${board.key}" type="button">
        <div>
          <div class="board-label">${esc(board.label)}</div>
          <div class="board-desc">${esc(board.desc)}</div>
        </div>
        <div class="board-meta">
          <div class="board-count">${counts[board.key] || 0}</div>
          <div class="board-last">${last ? esc(last.title || 'Latest post') : 'No posts yet'}</div>
        </div>
      </button>
    `;
  }).join('');

  wrap.querySelectorAll('.boardBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeBoard = btn.dataset.board;
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

  let data = listings.filter((item) => isVisibleToViewer(item) && (activeBoard === 'ALL' || item.board === activeBoard));

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

function getListingImageLayouts(item) {
  if (!Array.isArray(item?.imageLayouts)) return [];
  return item.imageLayouts.map((layout) => normalizePictureLayout(layout));
}

function getPictureGalleryBlocks(item) {
  if (Array.isArray(item?.galleryBlocks) && item.galleryBlocks.length) {
    return item.galleryBlocks.map((block, index) => {
      if (String(block?.type || '').toLowerCase() === 'text') {
        return {
          id: block.id || `text-${index}`,
          type: 'text',
          heading: String(block.heading || ''),
          text: String(block.text || ''),
          size: normalizeStudioBlockSize(block.size, 'text'),
          align: normalizeStudioBlockAlign(block.align),
          style: ['body', 'hero', 'note'].includes(String(block.style || '').toLowerCase()) ? String(block.style || '').toLowerCase() : 'body'
        };
      }
      return {
        id: block.id || `image-${index}`,
        type: 'image',
        url: String(block.url || block.src || ''),
        caption: String(block.caption || ''),
        size: normalizeStudioBlockSize(block.size || legacyLayoutToStudioSize(block.layout), 'image'),
        align: normalizeStudioBlockAlign(block.align),
        height: normalizeStudioBlockHeight(block.height || 280),
        layout: studioSizeToLegacyLayout(block.size || legacyLayoutToStudioSize(block.layout))
      };
    }).filter((block) => (block.type === 'image' ? block.url : (block.heading || block.text)));
  }
  const urls = getListingImageUrls(item);
  const layouts = getListingImageLayouts(item);
  const captions = Array.isArray(item?.imageCaptions) ? item.imageCaptions : [];
  const imageBlocks = urls.map((url, index) => ({
    id: `image-${index}`,
    type: 'image',
    url,
    caption: String(captions[index] || ''),
    size: legacyLayoutToStudioSize(layouts[index] || 'standard'),
    align: 'center',
    height: layouts[index] === 'hero' ? 420 : 280,
    layout: layouts[index] || 'standard'
  }));
  const desc = String(item?.description || item?.desc || '').trim();
  if (desc) {
    imageBlocks.push({
      id: 'legacy-text-1',
      type: 'text',
      heading: '',
      text: desc,
      size: 'wide',
      align: 'center',
      style: 'body'
    });
  }
  return imageBlocks;
}

function getPictureGalleryImages(item) {
  return getPictureGalleryBlocks(item)
    .filter((block) => block.type === 'image')
    .map((block) => ({ url: block.url, layout: studioSizeToLegacyLayout(block.size), size: block.size, caption: block.caption || '', height: block.height || 280 }));
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
  const images = getPictureGalleryImages(item);
  if (!images.length) return '';
  const preview = images.slice(0, 4);
  const extra = images.length - preview.length;
  return `<div class="galleryPreview galleryPreview-${preview.length}">${preview.map((image, idx) => `<div class="galleryPreviewCell ${idx === 0 ? 'primary' : ''} layout-${esc(image.layout)}"><img src="${esc(image.url)}" alt="${esc(item?.title || 'Gallery image')}" loading="lazy" /></div>`).join('')}${extra > 0 ? `<div class="galleryPreviewMore">+${extra}</div>` : ''}</div>`;
}

function buildThreadGallery(item) {
  const blocks = getPictureGalleryBlocks(item);
  if (!blocks.length) return '';
  return `
    <div class="publishedGalleryFlow">
      ${blocks.map((block, index) => {
        if (block.type === 'text') {
          return `
            <section class="publishedGalleryBlock publishedGalleryText publishedGalleryText-${esc(block.style || 'body')} text-size-${esc(block.size || 'wide')} align-${esc(normalizeStudioBlockAlign(block.align))}">
              ${block.heading ? `<h3>${esc(block.heading)}</h3>` : ''}
              ${block.text ? `<p>${esc(block.text).replaceAll('\n', '<br>')}</p>` : '<p>Add copy in Pictures Studio.</p>'}
            </section>
          `;
        }
        return `
          <figure class="publishedGalleryBlock publishedGalleryImage size-${esc(block.size || 'wide')} align-${esc(normalizeStudioBlockAlign(block.align))}" style="--published-image-height:${normalizeStudioBlockHeight(block.height || 280)}px">
            <img class="thread-gallery-image" src="${esc(block.url)}" alt="${esc((item?.title || 'Gallery image') + ' ' + (index + 1))}" loading="lazy" />
            ${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}
          </figure>
        `;
      }).join('')}
    </div>
  `;
}

function buildPictureGalleryFeed(items) {
  return `<div class="pictureGalleryGrid">${items.map((item) => {
    const images = getPictureGalleryImages(item);
    const preview = images.slice(0, 4);
    const statusClass = item.status === 'SOLD' ? 'sold' : item.reactivationRequested ? 'pending' : 'active';
    const statusText = item.reactivationRequested ? 'Reactivation Requested' : ((item.status === 'SOLD') ? getClosedLabel(item) : (item.status || 'ACTIVE'));
    const posterName = getPosterDisplayName(item);
    const canEdit = canModify(item);
    const quickDelete = canModerate() ? `<button class="btn danger" data-action="deletePost" data-id="${esc(item.id)}" type="button">Delete</button>` : '';
    const openButton = `<button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open Gallery</button>`;
    const editButton = canEdit ? `<button class="btn ghost" data-action="editPost" data-id="${esc(item.id)}" type="button">Edit</button>` : '';
    const markButton = canEdit && item.status !== 'SOLD' ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">${esc(getMarkClosedLabel(item))}</button>` : '';
    const mosaicClass = `pictureMosaic pictureMosaic-${Math.min(Math.max(preview.length, 1), 4)}`;
    const mosaic = preview.length
      ? `<div class="${mosaicClass}">${preview.map((image, idx) => `<div class="pictureMosaicCell ${idx === 0 ? 'lead' : ''} layout-${esc(image.layout)}"><img src="${esc(image.url)}" alt="${esc((item?.title || 'Picture') + ' ' + (idx + 1))}" loading="lazy" /></div>`).join('')}${images.length > preview.length ? `<div class="pictureMosaicMore">+${images.length - preview.length}</div>` : ''}</div>`
      : `<div class="${mosaicClass}"><div class="pictureMosaicCell lead pictureMosaicPlaceholder"><span>No image</span></div></div>`;
    return `
      <article class="pictureGalleryCard ${item.featured ? 'pictureGalleryCard-featured' : ''}" data-thread-card-id="${esc(item.id)}">
        <button class="pictureGalleryMedia" data-action="openThread" data-id="${esc(item.id)}" type="button" aria-label="Open ${esc(item.title || 'gallery')}">
          ${mosaic}
          <div class="pictureGalleryOverlay">
            <span class="pictureGalleryTag">Pictures</span>
            <span class="pictureGalleryCount">${esc(images.length ? `${images.length} photo${images.length === 1 ? '' : 's'}` : 'Gallery')}</span>
          </div>
        </button>
        <div class="pictureGalleryCardBody">
          <div class="pictureGalleryCardTop">
            <div class="pictureGalleryTitle">${esc(item.title || 'Untitled')}</div>
            <span class="status ${statusClass}">${esc(statusText)}</span>
          </div>
          <div class="pictureGalleryMeta"><span>${esc(posterName)}</span><span>${esc(item.location || 'Regal Lakeland')}</span><span>${esc(formatDate(item.createdAtMs))}</span></div>
          <div class="pictureGalleryActions rowBtns">${openButton}${editButton}${markButton}${quickDelete}</div>
        </div>
      </article>
    `;
  }).join('')}</div>`;
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
  resetPictureStudioItems();
  configurePostBoardOptions();
  refreshPhotoFieldHint();
  refreshPostComposerMode();
}

function openPostEditor(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  if (String(item.board || '').toUpperCase() === 'PICTURES') {
    legacyOpenPicturesDesigner(id);
    return;
  }
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
  if (String(item.board || '').toUpperCase() === 'PICTURES') {
    hydratePictureStudioFromListing(item);
  } else {
    resetPictureStudioItems();
  }
  configurePostBoardOptions();
  refreshPhotoFieldHint();
  refreshPostComposerMode();
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
  const feedTitleEl = document.querySelector('.feedPanel .section-title');
  const feedSubEl = document.querySelector('.feedPanel .section-sub');
  if (feedTitleEl) feedTitleEl.textContent = activeBoard === 'PICTURES' ? 'Picture Gallery' : 'Listings';
  if (feedSubEl) feedSubEl.textContent = activeBoard === 'PICTURES' ? 'Curated photo stories with live-designed layouts, captions, and text sections.' : 'Recent activity inside the selected board';
  if ($('btnNew')) {
    $('btnNew').style.display = activeBoard === 'PICTURES' && !canPostPicturesBoard() ? 'none' : '';
    $('btnNew').textContent = activeBoard === 'PICTURES' && canPostPicturesBoard() ? '+ Studio' : '+ Post';
  }
  if ($('countLine')) $('countLine').textContent = `${data.length} shown | ${visibleListings.length} live`;
  if ($('heroListingCount')) $('heroListingCount').textContent = String(visibleListings.length);
  updateHeroPeopleStats();
  renderEventSpotlight();
  if ($('heroRecentText')) $('heroRecentText').textContent = latest ? latest.title : 'Waiting for new posts';
  if ($('heroFreeBtn')) $('heroFreeBtn').textContent = activeBoard === 'PICTURES' ? 'Browse Free Items' : 'Browse Free Items';
  syncHeroComposerButtons();

  if (!data.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    updateThreadNotificationUI();
    return;
  }

  empty.style.display = 'none';
  wrap.classList.toggle('pictureBoardActive', activeBoard === 'PICTURES');
  if (activeBoard === 'PICTURES') {
    wrap.innerHTML = buildPictureGalleryFeed(data);
    updateThreadNotificationUI();
    return;
  }

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
    const isPictureBoard = String(item.board || '').toUpperCase() === 'PICTURES';
    const galleryPreview = isPictureBoard ? buildGalleryPreview(item) : '';
    const visualValue = getListingDisplayValue(item);
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

  const rawTitle = $('fTitle')?.value.trim() || '';
  const rawDescription = $('fDesc')?.value.trim() || '';
  const board = $('fBoard')?.value || 'BUYSELL';
  const pictureMode = board === 'PICTURES';
  if (pictureMode) {
    alert('Use the Pictures Studio to publish gallery posts.');
    hide('postOverlay');
    legacyOpenPicturesDesigner(editingPostId || null);
    return;
  }
  const status = pictureMode ? 'ACTIVE' : ($('fStatus')?.value || 'ACTIVE');
  if (pictureMode && !canPostPicturesBoard()) {
    alert('Only approved gallery managers can post in Pictures.');
    return;
  }
  const location = $('fLocation')?.value.trim() || '';
  const contact = $('fContact')?.value.trim() || '';
  const priceRaw = pictureMode ? '0' : ($('fPrice')?.value.trim() || '');
  const files = Array.from($('fPhoto')?.files || []);

  const title = rawTitle || (pictureMode ? `Gallery • ${new Date().toLocaleDateString()}` : '');
  const description = pictureMode ? rawDescription : rawDescription;

  if (!title) {
    alert('Enter a title.');
    return;
  }
  if (!pictureMode && !description) {
    alert('Enter a description.');
    return;
  }

  const moderationScan = detectModerationIssues([title, description, location, contact].join(' '));
  let imageUrl = '';
  let imageUrls = [];
  let imageLayouts = [];
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
      imageLayouts = getListingImageLayouts(existing);
    }

    if (pictureMode) {
      const studioItems = pictureStudioItems.slice();
      if (!studioItems.length) {
        alert('Please add at least one photo for the Pictures board.');
        return;
      }
      const finalUrls = [];
      const finalLayouts = [];
      for (const [index, item] of studioItems.entries()) {
        if (item.file) {
          const safeName = `${Date.now()}-${index}-${String(item.file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
          await uploadBytes(storageRef, item.file);
          finalUrls.push(await getDownloadURL(storageRef));
        } else if (item.sourceUrl || item.previewUrl) {
          finalUrls.push(item.sourceUrl || item.previewUrl);
        }
        finalLayouts.push(normalizePictureLayout(item.layout));
      }
      imageUrls = finalUrls;
      imageLayouts = finalLayouts;
      imageUrl = finalUrls[0] || '';
    } else if (files.length) {
      const uploadedUrls = [];
      for (const [index, file] of files.entries()) {
        const safeName = `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
        await uploadBytes(storageRef, file);
        uploadedUrls.push(await getDownloadURL(storageRef));
      }
      imageUrls = uploadedUrls;
      imageUrl = uploadedUrls[0] || '';
      imageLayouts = [];
    }

    if (pictureMode && !imageUrls.length && !imageUrl) {
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
      imageLayouts,
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

    resetPostEditor();
    hide('postOverlay');
  } catch (error) {
    console.error('Save post error', error);
    alert(error?.message || 'Could not save post.');
  } finally {
    isSavingPost = false;
    if ($('btnSavePost')) $('btnSavePost').disabled = false;
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

/* ===== Ultimate Pictures Studio page-builder overrides ===== */
let pictureDesignerSelectedId = '';
let pictureDesignerCanvasHeight = 1800;
let pictureDesignerSnapEnabled = true;
let pictureDesignerInteractionState = null;
const PICTURES_DESIGN_BASE_WIDTH = 1200;

function clampStudioNumber(value, min, max, fallback = min) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function normalizeStudioPercent(value, fallback = 10, min = 0, max = 100) {
  return Number(clampStudioNumber(value, min, max, fallback).toFixed(2));
}

function normalizeStudioDimensionPercent(value, fallback = 28, min = 4, max = 100) {
  return Number(clampStudioNumber(value, min, max, fallback).toFixed(2));
}

function normalizeStudioLayer(value, fallback = 2) {
  return Math.round(clampStudioNumber(value, 1, 99, fallback));
}

function normalizeStudioOpacity(value, fallback = 1) {
  return Number(clampStudioNumber(value, 0.2, 1, fallback).toFixed(2));
}

function normalizeStudioRadius(value, fallback = 18) {
  return Math.round(clampStudioNumber(value, 0, 40, fallback));
}

function normalizeStudioFontSize(value, fallback = 18) {
  return Math.round(clampStudioNumber(value, 14, 88, fallback));
}

function normalizeStudioFit(value) {
  return String(value || '').toLowerCase() === 'contain' ? 'contain' : 'cover';
}

function normalizePictureGalleryCanvasHeight(value) {
  return Math.round(clampStudioNumber(value, 900, 4200, 1800));
}

function getPictureGalleryCanvasHeight(item) {
  return normalizePictureGalleryCanvasHeight(item?.galleryCanvasHeight || item?.canvasHeight || 1800);
}

function defaultPicturesDesignerPlacement(type = 'image') {
  const count = pictureDesignerBlocks.length;
  const col = count % 3;
  const row = Math.floor(count / 3) % 5;
  if (type === 'text') {
    return {
      x: 6 + (col * 28),
      y: 12 + (row * 14),
      w: 32,
      h: 16,
      z: count + 2
    };
  }
  return {
    x: 6 + (col * 30),
    y: 10 + (row * 18),
    w: 28,
    h: 22,
    z: count + 2
  };
}

function normalizePicturesDesignerBlock(block = {}, index = 0) {
  const placement = defaultPicturesDesignerPlacement(block.type === 'text' ? 'text' : 'image');
  const common = {
    id: block.id || studioBlockId(),
    type: block.type === 'text' ? 'text' : 'image',
    x: normalizeStudioPercent(block.x, placement.x, 0, 96),
    y: normalizeStudioPercent(block.y, placement.y, 0, 96),
    w: normalizeStudioDimensionPercent(block.w, placement.w, 6, 100),
    h: normalizeStudioDimensionPercent(block.h, placement.h, 6, 100),
    z: normalizeStudioLayer(block.z, index + 2),
    opacity: normalizeStudioOpacity(block.opacity, 1),
    radius: normalizeStudioRadius(block.radius, 18)
  };
  if (common.x + common.w > 100) common.x = Math.max(0, 100 - common.w);
  if (common.y + common.h > 100) common.y = Math.max(0, 100 - common.h);

  if (common.type === 'text') {
    return {
      ...common,
      heading: String(block.heading || ''),
      text: String(block.text || ''),
      fontSize: normalizeStudioFontSize(block.fontSize, String(block.style || '').toLowerCase() === 'hero' ? 34 : 18),
      fontWeight: String(block.fontWeight || (String(block.style || '').toLowerCase() === 'hero' ? '800' : '600')),
      fontFamily: String(block.fontFamily || 'Inter, system-ui, sans-serif'),
      textColor: String(block.textColor || '#ffffff'),
      bgColor: String(block.bgColor || (String(block.style || '').toLowerCase() === 'note' ? '#161d29' : '#10151f')),
      textAlign: ['left', 'center', 'right'].includes(String(block.textAlign || '').toLowerCase()) ? String(block.textAlign).toLowerCase() : normalizeStudioBlockAlign(block.align),
      style: ['body', 'hero', 'note'].includes(String(block.style || '').toLowerCase()) ? String(block.style).toLowerCase() : 'body'
    };
  }
  return {
    ...common,
    file: block.file || null,
    previewUrl: block.previewUrl || block.url || '',
    sourceUrl: String(block.sourceUrl || block.url || block.src || ''),
    caption: String(block.caption || ''),
    fit: normalizeStudioFit(block.fit),
    name: String(block.name || 'Photo')
  };
}

function createPicturesDesignerImageBlock({ file = null, url = '', caption = '', name = '', x, y, w, h, z, fit = 'cover', radius = 18, opacity = 1 } = {}) {
  const previewUrl = file ? URL.createObjectURL(file) : String(url || '');
  return normalizePicturesDesignerBlock({
    id: studioBlockId(),
    type: 'image',
    file,
    previewUrl,
    sourceUrl: String(url || ''),
    caption,
    name: name || file?.name || 'Photo',
    x, y, w, h, z, fit, radius, opacity
  }, pictureDesignerBlocks.length);
}

function createPicturesDesignerTextBlock({ heading = '', text = '', x, y, w, h, z, fontSize, fontWeight, fontFamily, textColor, bgColor, textAlign, style = 'body', radius = 18, opacity = 1 } = {}) {
  return normalizePicturesDesignerBlock({
    id: studioBlockId(),
    type: 'text',
    heading,
    text,
    x, y, w, h, z,
    fontSize,
    fontWeight,
    fontFamily,
    textColor,
    bgColor,
    textAlign,
    style,
    radius,
    opacity
  }, pictureDesignerBlocks.length);
}

function getPicturesDesignerSelectedBlock() {
  return pictureDesignerBlocks.find((block) => block.id === pictureDesignerSelectedId) || null;
}

function refreshStudioSnapToggle() {
  const btn = $('studioSnapToggle');
  if (btn) btn.textContent = `Snap: ${pictureDesignerSnapEnabled ? 'On' : 'Off'}`;
}

function setPicturesDesignerCanvasHeight(value, options = {}) {
  pictureDesignerCanvasHeight = normalizePictureGalleryCanvasHeight(value);
  const input = $('studioCanvasHeight');
  if (input && String(input.value) !== String(pictureDesignerCanvasHeight)) input.value = String(pictureDesignerCanvasHeight);
  if (options.render !== false) renderPicturesDesigner();
}

function selectPicturesDesignerBlock(blockId = '') {
  pictureDesignerSelectedId = blockId || '';
  document.querySelectorAll('.designerFreeBlock').forEach((node) => node.classList.toggle('is-selected', node.dataset.blockId === pictureDesignerSelectedId));
  syncPicturesDesignerInspector();
  updatePicturesDesignerStatus();
}

function syncPicturesDesignerInspector() {
  const block = getPicturesDesignerSelectedBlock();
  const noSelection = $('studioNoSelection');
  const panel = $('studioSelectedPanel');
  const imageControls = $('studioImageControls');
  const imageStyleControls = $('studioImageStyleControls');
  const textControls = $('studioTextControls');
  if (!block) {
    if (noSelection) noSelection.style.display = '';
    if (panel) panel.style.display = 'none';
    return;
  }
  if (noSelection) noSelection.style.display = 'none';
  if (panel) panel.style.display = 'block';
  if ($('studioSelectedType')) $('studioSelectedType').value = block.type === 'image' ? 'Image' : 'Text';
  if ($('studioLayer')) $('studioLayer').value = String(block.z || 1);
  if ($('studioPosX')) $('studioPosX').value = String(block.x || 0);
  if ($('studioPosY')) $('studioPosY').value = String(block.y || 0);
  if ($('studioSizeW')) $('studioSizeW').value = String(block.w || 10);
  if ($('studioSizeH')) $('studioSizeH').value = String(block.h || 10);
  if (imageControls) imageControls.style.display = block.type === 'image' ? 'grid' : 'none';
  if (imageStyleControls) imageStyleControls.style.display = block.type === 'image' ? 'grid' : 'none';
  if (textControls) textControls.style.display = block.type === 'text' ? 'block' : 'none';
  if (block.type === 'image') {
    if ($('studioImageCaption')) $('studioImageCaption').value = block.caption || '';
    if ($('studioImageFit')) $('studioImageFit').value = normalizeStudioFit(block.fit);
    if ($('studioRadius')) $('studioRadius').value = String(block.radius || 18);
    if ($('studioOpacity')) $('studioOpacity').value = String(block.opacity || 1);
  } else {
    if ($('studioTextHeading')) $('studioTextHeading').value = block.heading || '';
    if ($('studioTextBody')) $('studioTextBody').value = block.text || '';
    if ($('studioFontSize')) $('studioFontSize').value = String(block.fontSize || 18);
    if ($('studioFontWeight')) $('studioFontWeight').value = String(block.fontWeight || '600');
    if ($('studioFontFamily')) $('studioFontFamily').value = String(block.fontFamily || 'Inter, system-ui, sans-serif');
    if ($('studioTextColor')) $('studioTextColor').value = block.textColor || '#ffffff';
    if ($('studioBgColor')) $('studioBgColor').value = block.bgColor || '#10151f';
    if ($('studioTextAlign')) $('studioTextAlign').value = block.textAlign || 'left';
    if ($('studioRadius')) $('studioRadius').value = String(block.radius || 18);
    if ($('studioOpacity')) $('studioOpacity').value = String(block.opacity || 1);
  }
}

function updatePicturesDesignerStatus() {
  const statusEl = $('studioStatusLine');
  if (!statusEl) return;
  const imageCount = pictureDesignerBlocks.filter((block) => block.type === 'image').length;
  const textCount = pictureDesignerBlocks.filter((block) => block.type === 'text').length;
  const selected = getPicturesDesignerSelectedBlock();
  const title = $('studioTitle')?.value.trim() || (pictureDesignerEditingId ? 'Editing gallery' : 'New gallery');
  const selectedText = selected ? ` • Selected: ${selected.type === 'image' ? 'Image' : 'Text'}` : '';
  statusEl.textContent = `${title} • ${imageCount} photo${imageCount === 1 ? '' : 's'} • ${textCount} text block${textCount === 1 ? '' : 's'} • ${pictureDesignerCanvasHeight}px page height${selectedText}`;
}

function clearPicturesDesigner(silent = false) {
  if (!silent && pictureDesignerBlocks.length && !confirm('Clear the current gallery canvas?')) return;
  pictureDesignerBlocks.forEach(releasePicturesDesignerBlock);
  pictureDesignerBlocks = [];
  pictureDesignerDragId = '';
  pictureDesignerSelectedId = '';
  pictureDesignerInteractionState = null;
  renderPicturesDesigner();
}

function resetPicturesDesigner() {
  clearPicturesDesigner(true);
  pictureDesignerEditingId = null;
  pictureDesignerCanvasHeight = 1800;
  pictureDesignerSnapEnabled = true;
  if ($('studioTitle')) $('studioTitle').value = '';
  if ($('studioLocation')) $('studioLocation').value = '';
  if ($('studioContact')) $('studioContact').value = '';
  if ($('studioCanvasHeight')) $('studioCanvasHeight').value = '1800';
  refreshStudioSnapToggle();
  syncPicturesDesignerInspector();
  updatePicturesDesignerStatus();
}

function addFilesToPicturesDesigner(files) {
  const images = (files || []).filter((file) => file && String(file.type || '').startsWith('image/'));
  if (!images.length) return;
  const blocks = images.map((file, index) => {
    const place = defaultPicturesDesignerPlacement('image');
    return createPicturesDesignerImageBlock({
      file,
      x: place.x + (index * 2),
      y: place.y + (index * 2),
      w: place.w,
      h: place.h,
      z: pictureDesignerBlocks.length + index + 2
    });
  });
  pictureDesignerBlocks = [...pictureDesignerBlocks, ...blocks];
  pictureDesignerSelectedId = blocks.at(-1)?.id || pictureDesignerSelectedId;
  renderPicturesDesigner();
}

function addTextBlockToPicturesDesigner(_insertIndex = null, style = 'body') {
  const place = defaultPicturesDesignerPlacement('text');
  const block = createPicturesDesignerTextBlock({
    heading: style === 'hero' ? 'Title goes here' : '',
    text: style === 'hero' ? 'Click here and type your headline or event callout.' : 'Click here and type your text.',
    x: place.x,
    y: place.y,
    w: style === 'hero' ? 52 : place.w,
    h: style === 'hero' ? 18 : place.h,
    z: pictureDesignerBlocks.length + 2,
    fontSize: style === 'hero' ? 34 : 18,
    fontWeight: style === 'hero' ? '800' : '600',
    style,
    bgColor: style === 'hero' ? '#0f1520' : '#10151f'
  });
  pictureDesignerBlocks = [...pictureDesignerBlocks, block];
  pictureDesignerSelectedId = block.id;
  renderPicturesDesigner();
}

function updatePicturesDesignerBlock(blockId, patch = {}, options = {}) {
  const shouldRender = options.render !== false;
  pictureDesignerBlocks = pictureDesignerBlocks.map((block, index) => {
    if (block.id !== blockId) return block;
    return normalizePicturesDesignerBlock({ ...block, ...patch }, index);
  });
  if (!pictureDesignerBlocks.some((block) => block.id === pictureDesignerSelectedId)) pictureDesignerSelectedId = '';
  if (shouldRender) renderPicturesDesigner();
  else {
    updatePicturesDesignerBlockElement(blockId);
    syncPicturesDesignerInspector();
    updatePicturesDesignerStatus();
  }
}

function removePicturesDesignerBlock(blockId) {
  const target = pictureDesignerBlocks.find((block) => block.id === blockId);
  if (target) releasePicturesDesignerBlock(target);
  pictureDesignerBlocks = pictureDesignerBlocks.filter((block) => block.id !== blockId);
  if (pictureDesignerSelectedId === blockId) pictureDesignerSelectedId = pictureDesignerBlocks.at(-1)?.id || '';
  renderPicturesDesigner();
}

function duplicatePicturesDesignerBlock(blockId) {
  const target = pictureDesignerBlocks.find((block) => block.id === blockId);
  if (!target) return;
  const clone = target.type === 'image'
    ? createPicturesDesignerImageBlock({
        url: target.sourceUrl || target.previewUrl,
        caption: target.caption,
        name: target.name,
        x: Math.min(92, (target.x || 0) + 2),
        y: Math.min(92, (target.y || 0) + 2),
        w: target.w,
        h: target.h,
        z: (target.z || 1) + 1,
        fit: target.fit,
        radius: target.radius,
        opacity: target.opacity
      })
    : createPicturesDesignerTextBlock({
        heading: target.heading,
        text: target.text,
        x: Math.min(92, (target.x || 0) + 2),
        y: Math.min(92, (target.y || 0) + 2),
        w: target.w,
        h: target.h,
        z: (target.z || 1) + 1,
        fontSize: target.fontSize,
        fontWeight: target.fontWeight,
        fontFamily: target.fontFamily,
        textColor: target.textColor,
        bgColor: target.bgColor,
        textAlign: target.textAlign,
        style: target.style,
        radius: target.radius,
        opacity: target.opacity
      });
  pictureDesignerBlocks = [...pictureDesignerBlocks, clone];
  pictureDesignerSelectedId = clone.id;
  renderPicturesDesigner();
}

function movePicturesDesignerBlock(blockId, direction = 'up') {
  const block = pictureDesignerBlocks.find((entry) => entry.id === blockId);
  if (!block) return;
  const delta = direction === 'up' ? 1 : -1;
  updatePicturesDesignerBlock(blockId, { z: normalizeStudioLayer((block.z || 1) + delta, block.z || 1) });
}

function reorderPicturesDesignerBlocks(fromId, toId) {
  const from = pictureDesignerBlocks.find((entry) => entry.id === fromId);
  const to = pictureDesignerBlocks.find((entry) => entry.id === toId);
  if (!from || !to) return;
  const temp = from.z;
  updatePicturesDesignerBlock(fromId, { z: to.z }, { render: false });
  updatePicturesDesignerBlock(toId, { z: temp }, { render: false });
  renderPicturesDesigner();
}

function picturesDesignerBlockInlineStyle(block) {
  return [
    `left:${block.x}%`,
    `top:${block.y}%`,
    `width:${block.w}%`,
    `height:${block.h}%`,
    `z-index:${block.z}`,
    `opacity:${block.opacity}`
  ].join(';');
}

function updatePicturesDesignerBlockElement(blockId) {
  const block = pictureDesignerBlocks.find((entry) => entry.id === blockId);
  if (!block) return;
  const el = document.querySelector(`.designerFreeBlock[data-block-id="${blockId}"]`);
  if (!el) return;
  el.style.cssText = picturesDesignerBlockInlineStyle(block);
  const inner = el.querySelector('.published-inner, .designerTextCard, .designerImageCard');
  if (inner) {
    inner.style.borderRadius = `${block.radius || 18}px`;
  }
  if (block.type === 'image') {
    const img = el.querySelector('img');
    if (img) {
      img.style.objectFit = normalizeStudioFit(block.fit);
      img.style.borderRadius = `${block.radius || 18}px ${block.radius || 18}px 0 0`;
    }
    const cap = el.querySelector('.designerImageCaption');
    if (cap) cap.innerHTML = esc(block.caption || '').replaceAll('\n', '<br>');
  } else {
    const card = el.querySelector('.designerTextCard');
    if (card) {
      card.style.background = block.bgColor || '#10151f';
      card.style.color = block.textColor || '#ffffff';
      card.style.textAlign = block.textAlign || 'left';
      card.style.borderRadius = `${block.radius || 18}px`;
      card.style.fontFamily = block.fontFamily || 'Inter, system-ui, sans-serif';
      card.style.fontSize = `${block.fontSize || 18}px`;
      card.style.fontWeight = String(block.fontWeight || '600');
    }
    const heading = el.querySelector('.designerTextHeading');
    const body = el.querySelector('.designerTextBody');
    if (heading) heading.innerHTML = esc(block.heading || '').replaceAll('\n', '<br>');
    if (body) body.innerHTML = esc(block.text || '').replaceAll('\n', '<br>');
  }
}

function renderPicturesDesigner() {
  const canvas = $('picturesDesignerCanvas');
  if (!canvas) return;
  const title = $('studioTitle')?.value.trim() || 'Untitled gallery';
  const location = $('studioLocation')?.value.trim() || 'Regal Lakeland';
  const contact = $('studioContact')?.value.trim() || 'Gallery manager';
  if (!pictureDesignerBlocks.length) {
    canvas.innerHTML = `
      <div class="designerCanvasEmpty">
        <div class="designerCanvasEmptyInner">
          <strong>Build the Pictures page visually</strong>
          <span>Add photos or text, then drag them anywhere on the page. Resize from the bottom-right corner and use the inspector on the left for captions, fonts, colors, and layering.</span>
        </div>
      </div>
    `;
    syncPicturesDesignerInspector();
    updatePicturesDesignerStatus();
    refreshStudioSnapToggle();
    return;
  }
  const sortedBlocks = pictureDesignerBlocks.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  canvas.innerHTML = `
    <div class="picturesDesignerStageWrap">
      <div class="picturesDesignerStage ${pictureDesignerSnapEnabled ? '' : 'stage-snap-off'}" id="picturesDesignerStage" style="aspect-ratio:${PICTURES_DESIGN_BASE_WIDTH} / ${pictureDesignerCanvasHeight};">
        <div class="picturesDesignerStageMeta">
          <div class="picturesDesignerStageMetaTitle">
            <strong>${esc(title)}</strong>
            <span>${esc(location)} • ${esc(contact)}</span>
          </div>
          <div class="picturesDesignerStageHint">Move handle • Resize corner • Click text to type</div>
        </div>
        ${sortedBlocks.map((block) => {
          if (block.type === 'image') {
            return `
              <article class="designerFreeBlock ${pictureDesignerSelectedId === block.id ? 'is-selected' : ''}" data-block-id="${esc(block.id)}" style="${picturesDesignerBlockInlineStyle(block)}">
                <div class="designerBlockChrome">
                  <div class="designerBlockToolbar">
                    <div class="chip designerMoveHandle" data-studio-move="${esc(block.id)}">Move image</div>
                    <div class="chip">Layer ${esc(block.z)}</div>
                  </div>
                  <figure class="designerImageCard" style="border-radius:${block.radius}px">
                    <img src="${esc(block.previewUrl || block.sourceUrl)}" alt="${esc(block.name || 'Gallery image')}" loading="lazy" style="object-fit:${esc(normalizeStudioFit(block.fit))};border-radius:${block.radius}px ${block.radius}px 0 0" />
                    ${block.caption ? `<figcaption class="designerImageCaption">${esc(block.caption).replaceAll('\n', '<br>')}</figcaption>` : '<figcaption class="designerImageCaption">Add a caption from the left panel.</figcaption>'}
                  </figure>
                  <button class="designerResizeHandle" data-studio-resize="${esc(block.id)}" type="button" aria-label="Resize image"></button>
                </div>
              </article>
            `;
          }
          return `
            <article class="designerFreeBlock ${pictureDesignerSelectedId === block.id ? 'is-selected' : ''}" data-block-id="${esc(block.id)}" style="${picturesDesignerBlockInlineStyle(block)}">
              <div class="designerBlockChrome">
                <div class="designerBlockToolbar">
                  <div class="chip designerMoveHandle" data-studio-move="${esc(block.id)}">Move text</div>
                  <div class="chip">Layer ${esc(block.z)}</div>
                </div>
                <div class="designerTextCard" style="background:${esc(block.bgColor || '#10151f')};color:${esc(block.textColor || '#ffffff')};text-align:${esc(block.textAlign || 'left')};border-radius:${block.radius}px;font-family:${esc(block.fontFamily || 'Inter, system-ui, sans-serif')};font-size:${esc(block.fontSize || 18)}px;font-weight:${esc(block.fontWeight || '600')}">
                  <div class="designerTextHeading" contenteditable="true" spellcheck="true" data-studio-editable="heading" data-block-id="${esc(block.id)}" data-placeholder="Optional heading">${esc(block.heading || '').replaceAll('\n', '<br>')}</div>
                  <div class="designerTextBody" contenteditable="true" spellcheck="true" data-studio-editable="text" data-block-id="${esc(block.id)}" data-placeholder="Type your text here...">${esc(block.text || '').replaceAll('\n', '<br>')}</div>
                </div>
                <button class="designerResizeHandle" data-studio-resize="${esc(block.id)}" type="button" aria-label="Resize text block"></button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </div>
  `;
  bindPicturesDesignerBuilderEvents();
  syncPicturesDesignerInspector();
  updatePicturesDesignerStatus();
  refreshStudioSnapToggle();
}

function bindPicturesDesignerBuilderEvents() {
  const stage = $('picturesDesignerStage');
  if (!stage) return;
  stage.addEventListener('click', (event) => {
    if (event.target === stage) selectPicturesDesignerBlock('');
  });
  stage.querySelectorAll('.designerFreeBlock').forEach((node) => {
    node.addEventListener('mousedown', (event) => {
      if (event.target.closest('[data-studio-move], [data-studio-resize], [contenteditable="true"]')) return;
      selectPicturesDesignerBlock(node.dataset.blockId || '');
    });
  });
  stage.querySelectorAll('[data-studio-move]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => startPicturesDesignerInteraction(event, handle.dataset.studioMove || '', 'move'));
  });
  stage.querySelectorAll('[data-studio-resize]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => startPicturesDesignerInteraction(event, handle.dataset.studioResize || '', 'resize'));
  });
  stage.querySelectorAll('[data-studio-editable]').forEach((editable) => {
    editable.addEventListener('focus', () => selectPicturesDesignerBlock(editable.dataset.blockId || ''));
    editable.addEventListener('input', () => {
      const blockId = editable.dataset.blockId || '';
      const field = editable.dataset.studioEditable || 'text';
      const textValue = editable.innerText.replace(/\u00A0/g, ' ');
      updatePicturesDesignerBlock(blockId, { [field]: textValue }, { render: false });
      if (field === 'heading' && $('studioTextHeading')) $('studioTextHeading').value = textValue;
      if (field === 'text' && $('studioTextBody')) $('studioTextBody').value = textValue;
    });
  });
}

function startPicturesDesignerInteraction(event, blockId, mode = 'move') {
  const block = pictureDesignerBlocks.find((entry) => entry.id === blockId);
  const stage = $('picturesDesignerStage');
  if (!block || !stage) return;
  const rect = stage.getBoundingClientRect();
  selectPicturesDesignerBlock(blockId);
  pictureDesignerInteractionState = {
    blockId,
    mode,
    rect,
    startX: event.clientX,
    startY: event.clientY,
    initialX: block.x,
    initialY: block.y,
    initialW: block.w,
    initialH: block.h
  };
  document.body.classList.add(mode === 'resize' ? 'studio-resizing' : 'studio-dragging');
  event.preventDefault();
}

function applySnap(value) {
  const step = pictureDesignerSnapEnabled ? 1 : 0.25;
  return Math.round(value / step) * step;
}

function handlePicturesDesignerPointerMove(event) {
  const state = pictureDesignerInteractionState;
  if (!state) return;
  const block = pictureDesignerBlocks.find((entry) => entry.id === state.blockId);
  if (!block) return;
  const dx = ((event.clientX - state.startX) / state.rect.width) * 100;
  const dy = ((event.clientY - state.startY) / state.rect.height) * 100;
  if (state.mode === 'move') {
    block.x = normalizeStudioPercent(applySnap(state.initialX + dx), state.initialX, 0, Math.max(0, 100 - block.w));
    block.y = normalizeStudioPercent(applySnap(state.initialY + dy), state.initialY, 0, Math.max(0, 100 - block.h));
  } else {
    block.w = normalizeStudioDimensionPercent(applySnap(state.initialW + dx), state.initialW, 6, Math.max(6, 100 - block.x));
    block.h = normalizeStudioDimensionPercent(applySnap(state.initialH + dy), state.initialH, 6, Math.max(6, 100 - block.y));
  }
  updatePicturesDesignerBlockElement(block.id);
  syncPicturesDesignerInspector();
  updatePicturesDesignerStatus();
}

function stopPicturesDesignerResize() {
  if (!pictureDesignerInteractionState) return;
  pictureDesignerInteractionState = null;
  document.body.classList.remove('studio-resizing', 'studio-dragging');
}

function openPicturesDesigner(postId = null) {
  if (!currentUser) {
    alert('Please log in first.');
    return;
  }
  if (!hasRulesAcceptance(currentProfile)) {
    showRulesOverlay();
    alert('You must accept the marketplace rules before using the Pictures Studio.');
    return;
  }
  if (!canPostPicturesBoard()) {
    alert('Only approved gallery managers can use the Pictures Studio.');
    return;
  }
  resetPicturesDesigner();
  if (postId) {
    const item = listings.find((entry) => entry.id === postId);
    if (!item || !canModify(item)) {
      alert('You do not have permission to edit this gallery.');
      return;
    }
    pictureDesignerEditingId = postId;
    pictureDesignerCanvasHeight = getPictureGalleryCanvasHeight(item);
    if ($('studioCanvasHeight')) $('studioCanvasHeight').value = String(pictureDesignerCanvasHeight);
    if ($('studioTitle')) $('studioTitle').value = item.title || '';
    if ($('studioLocation')) $('studioLocation').value = item.location || '';
    if ($('studioContact')) $('studioContact').value = item.contact || '';
    pictureDesignerBlocks = getPictureGalleryBlocksDesigner(item).map((block, index) => normalizePicturesDesignerBlock(block, index));
    pictureDesignerSelectedId = pictureDesignerBlocks[0]?.id || '';
  }
  renderPicturesDesigner();
  setPicturesDesignerToolsCollapsed(false);
  show('picturesDesignerOverlay');
}

function closePicturesDesigner() {
  hide('picturesDesignerOverlay');
  setPicturesDesignerToolsCollapsed(false);
  resetPicturesDesigner();
}

function getPictureGalleryBlocksDesigner(item) {
  const canvasHeight = getPictureGalleryCanvasHeight(item);
  if (Array.isArray(item?.galleryBlocks) && item.galleryBlocks.length) {
    return item.galleryBlocks.map((block, index) => normalizePicturesDesignerBlock({
      ...block,
      type: String(block?.type || '').toLowerCase() === 'text' ? 'text' : 'image',
      sourceUrl: block.url || block.src || block.sourceUrl || '',
      previewUrl: block.url || block.src || block.previewUrl || ''
    }, index)).filter((block) => (block.type === 'image' ? (block.sourceUrl || block.previewUrl) : (block.heading || block.text)));
  }
  const urls = getListingImageUrls(item);
  const captions = Array.isArray(item?.imageCaptions) ? item.imageCaptions : [];
  const blocks = urls.map((url, index) => normalizePicturesDesignerBlock({
    id: `legacy-image-${index}`,
    type: 'image',
    url,
    sourceUrl: url,
    previewUrl: url,
    caption: String(captions[index] || ''),
    x: 6,
    y: 10 + (index * 26),
    w: 88,
    h: 22,
    z: index + 2,
    fit: 'cover',
    radius: 18,
    opacity: 1
  }, index));
  const desc = String(item?.description || item?.desc || '').trim();
  if (desc) {
    blocks.push(normalizePicturesDesignerBlock({
      id: 'legacy-text',
      type: 'text',
      heading: '',
      text: desc,
      x: 8,
      y: Math.min(88, 12 + (urls.length * 26)),
      w: 84,
      h: 14,
      z: urls.length + 3,
      fontSize: 18,
      fontWeight: '600',
      fontFamily: 'Inter, system-ui, sans-serif',
      textColor: '#ffffff',
      bgColor: '#10151f',
      textAlign: 'left',
      radius: 18,
      opacity: 1
    }, urls.length + 1));
  }
  return blocks.map((block) => ({ ...block, canvasHeight }));
}

function buildThreadGalleryDesigner(item) {
  const blocks = getPictureGalleryBlocksDesigner(item);
  if (!blocks.length) return '';
  const canvasHeight = getPictureGalleryCanvasHeight(item);
  const title = item?.title || 'Gallery';
  const meta = `${item?.location || 'Regal Lakeland'}${item?.contact ? ` • ${item.contact}` : ''}`;
  return `
    <div class="publishedGalleryCanvasWrap">
      <div class="publishedGalleryCanvas" style="aspect-ratio:${PICTURES_DESIGN_BASE_WIDTH} / ${canvasHeight};">
        <div class="publishedGalleryCanvasMeta">
          <div class="meta-card"><strong>${esc(title)}</strong><span>${esc(meta)}</span></div>
        </div>
        ${blocks.sort((a, b) => (a.z || 0) - (b.z || 0)).map((block, index) => {
          const style = `left:${block.x}%;top:${block.y}%;width:${block.w}%;height:${block.h}%;z-index:${block.z};opacity:${block.opacity};`;
          if (block.type === 'image') {
            return `
              <figure class="publishedGalleryFloatBlock published-image" style="${style}">
                <div class="published-inner" style="border-radius:${block.radius || 18}px">
                  <img src="${esc(block.sourceUrl || block.previewUrl)}" alt="${esc(title + ' ' + (index + 1))}" loading="lazy" style="object-fit:${esc(normalizeStudioFit(block.fit))};border-radius:${block.radius || 18}px ${block.radius || 18}px 0 0" />
                  ${block.caption ? `<figcaption>${esc(block.caption).replaceAll('\n', '<br>')}</figcaption>` : ''}
                </div>
              </figure>
            `;
          }
          return `
            <section class="publishedGalleryFloatBlock published-text" style="${style}">
              <div class="published-inner" style="background:${esc(block.bgColor || '#10151f')};color:${esc(block.textColor || '#ffffff')};text-align:${esc(block.textAlign || 'left')};border-radius:${block.radius || 18}px;font-family:${esc(block.fontFamily || 'Inter, system-ui, sans-serif')};font-size:${esc(block.fontSize || 18)}px;font-weight:${esc(block.fontWeight || '600')}">
                ${block.heading ? `<div class="published-heading">${esc(block.heading).replaceAll('\n', '<br>')}</div>` : ''}
                <div class="published-body">${esc(block.text || '').replaceAll('\n', '<br>')}</div>
              </div>
            </section>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function handleSavePicturesDesigner() {
  if (isSavingPost) return;
  if (!canPostPicturesBoard()) {
    alert('Only approved gallery managers can publish in Pictures.');
    return;
  }
  const title = $('studioTitle')?.value.trim() || `Gallery • ${new Date().toLocaleDateString()}`;
  const location = $('studioLocation')?.value.trim() || '';
  const contact = $('studioContact')?.value.trim() || '';
  const imageBlocks = pictureDesignerBlocks.filter((block) => block.type === 'image');
  if (!imageBlocks.length) {
    alert('Add at least one photo before publishing the gallery.');
    return;
  }
  const textSummary = pictureDesignerBlocks
    .filter((block) => block.type === 'text')
    .map((block) => [block.heading, block.text].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
  const moderationScan = detectModerationIssues([title, location, contact, textSummary].join(' '));
  isSavingPost = true;
  if ($('studioSaveBtn')) $('studioSaveBtn').disabled = true;
  try {
    let existing = null;
    if (pictureDesignerEditingId) {
      existing = listings.find((item) => item.id === pictureDesignerEditingId) || null;
      if (!existing || !canModify(existing)) {
        alert('You do not have permission to edit this gallery.');
        return;
      }
    }
    const finalBlocks = [];
    const imageUrls = [];
    const imageLayouts = [];
    const imageCaptions = [];
    for (const [index, block] of pictureDesignerBlocks.entries()) {
      if (block.type === 'text') {
        finalBlocks.push({
          id: block.id,
          type: 'text',
          heading: String(block.heading || '').trim(),
          text: String(block.text || '').trim(),
          x: block.x,
          y: block.y,
          w: block.w,
          h: block.h,
          z: block.z,
          opacity: normalizeStudioOpacity(block.opacity, 1),
          radius: normalizeStudioRadius(block.radius, 18),
          fontSize: normalizeStudioFontSize(block.fontSize, 18),
          fontWeight: String(block.fontWeight || '600'),
          fontFamily: String(block.fontFamily || 'Inter, system-ui, sans-serif'),
          textColor: String(block.textColor || '#ffffff'),
          bgColor: String(block.bgColor || '#10151f'),
          textAlign: ['left', 'center', 'right'].includes(String(block.textAlign || '').toLowerCase()) ? String(block.textAlign).toLowerCase() : 'left',
          style: ['body', 'hero', 'note'].includes(String(block.style || '').toLowerCase()) ? String(block.style).toLowerCase() : 'body'
        });
        continue;
      }
      let finalUrl = String(block.sourceUrl || '').trim();
      if (block.file) {
        const safeName = `${Date.now()}-${index}-${String(block.file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
        await uploadBytes(storageRef, block.file);
        finalUrl = await getDownloadURL(storageRef);
      }
      if (!finalUrl) continue;
      const cleanCaption = String(block.caption || '').trim();
      finalBlocks.push({
        id: block.id,
        type: 'image',
        url: finalUrl,
        caption: cleanCaption,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        z: block.z,
        fit: normalizeStudioFit(block.fit),
        radius: normalizeStudioRadius(block.radius, 18),
        opacity: normalizeStudioOpacity(block.opacity, 1),
        name: String(block.name || 'Photo')
      });
      imageUrls.push(finalUrl);
      imageLayouts.push('wide');
      imageCaptions.push(cleanCaption);
    }
    if (!imageUrls.length) {
      alert('At least one valid image is required to publish this gallery.');
      return;
    }
    const nowMs = Date.now();
    const payload = {
      category: 'PICTURES',
      board: 'PICTURES',
      status: 'ACTIVE',
      title,
      desc: textSummary,
      description: textSummary,
      location,
      contact,
      price: 0,
      photo: imageUrls[0] || '',
      imageUrl: imageUrls[0] || '',
      imageUrls,
      imageLayouts,
      imageCaptions,
      galleryBlocks: finalBlocks,
      galleryCanvasHeight: pictureDesignerCanvasHeight,
      moderationFlagged: moderationScan.flagged,
      moderationLabels: moderationScan.matchedLabels,
      moderationMatchedTerms: moderationScan.matchedTerms,
      moderationSeverity: moderationScan.severity,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs
    };
    if (existing) {
      await updateDoc(doc(db, 'listings', existing.id), payload);
      await logMarketplaceActivity(`Updated picture gallery: ${title}`, { type: 'gallery_update', lastBoardVisited: 'PICTURES', lastThreadId: existing.id, lastThreadTitle: title });
    } else {
      Object.assign(payload, {
        uid: currentUser.uid,
        authorEmail: currentUser.email || '',
        authorName: currentProfile?.displayName || currentUser.displayName || currentUser.email || 'Marketplace Member',
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
        soldAt: null,
        soldAtMs: null,
        views: 0,
        likes: 0,
        commentsCount: 0,
        hidden: false,
        deleted: false,
        threadParticipants: [],
        lastReplyAt: null,
        lastReplyAtMs: 0,
        lastReplyByUid: '',
        lastReplyByEmail: '',
        updatedByUid: currentUser.uid,
        updatedByEmail: currentUser.email || ''
      });
      const created = await addDoc(collection(db, 'listings'), payload);
      await logMarketplaceActivity(`Published picture gallery: ${title}`, { type: 'gallery_publish', lastBoardVisited: 'PICTURES', lastThreadId: created.id, lastThreadTitle: title });
    }
    closePicturesDesigner();
  } catch (error) {
    console.error('Save pictures designer error', error);
    alert(error?.message || 'Could not publish the gallery.');
  } finally {
    isSavingPost = false;
    if ($('studioSaveBtn')) $('studioSaveBtn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const bind = (id, eventName, handler) => {
    const el = $(id);
    if (el) el.addEventListener(eventName, handler);
  };
  bind('studioCanvasHeight', 'input', (event) => setPicturesDesignerCanvasHeight(event.target.value));
  bind('studioCanvasGrowBtn', 'click', () => setPicturesDesignerCanvasHeight(pictureDesignerCanvasHeight + 400));
  bind('studioCanvasShrinkBtn', 'click', () => setPicturesDesignerCanvasHeight(pictureDesignerCanvasHeight - 400));
  bind('studioSnapToggle', 'click', () => {
    pictureDesignerSnapEnabled = !pictureDesignerSnapEnabled;
    refreshStudioSnapToggle();
    const stage = $('picturesDesignerStage');
    if (stage) stage.classList.toggle('stage-snap-off', !pictureDesignerSnapEnabled);
  });
  bind('studioDeleteSelectedBtn', 'click', () => {
    if (pictureDesignerSelectedId) removePicturesDesignerBlock(pictureDesignerSelectedId);
  });
  bind('studioDuplicateSelectedBtn', 'click', () => {
    if (pictureDesignerSelectedId) duplicatePicturesDesignerBlock(pictureDesignerSelectedId);
  });
  bind('studioBringForwardBtn', 'click', () => {
    const block = getPicturesDesignerSelectedBlock();
    if (block) updatePicturesDesignerBlock(block.id, { z: (block.z || 1) + 1 });
  });
  bind('studioSendBackwardBtn', 'click', () => {
    const block = getPicturesDesignerSelectedBlock();
    if (block) updatePicturesDesignerBlock(block.id, { z: Math.max(1, (block.z || 1) - 1) });
  });

  const genericBindings = [
    ['studioLayer', 'z'],
    ['studioPosX', 'x'],
    ['studioPosY', 'y'],
    ['studioSizeW', 'w'],
    ['studioSizeH', 'h'],
    ['studioImageCaption', 'caption'],
    ['studioImageFit', 'fit'],
    ['studioRadius', 'radius'],
    ['studioOpacity', 'opacity'],
    ['studioTextHeading', 'heading'],
    ['studioTextBody', 'text'],
    ['studioFontSize', 'fontSize'],
    ['studioFontWeight', 'fontWeight'],
    ['studioFontFamily', 'fontFamily'],
    ['studioTextColor', 'textColor'],
    ['studioBgColor', 'bgColor'],
    ['studioTextAlign', 'textAlign']
  ];
  genericBindings.forEach(([id, field]) => {
    const el = $(id);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      if (!pictureDesignerSelectedId) return;
      updatePicturesDesignerBlock(pictureDesignerSelectedId, { [field]: el.value });
    });
  });
});
