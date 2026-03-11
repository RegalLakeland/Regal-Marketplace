import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
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
let authUtilityMode = '';

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
let listingsUnsub = null;
let profilesUnsub = null;
let presenceTimer = null;
let profiles = [];
let eventResponses = [];
let eventResponsesUnsub = null;
let lastUnverifiedEmail = '';
let isSavingPost = false;
let editingPostId = null;

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 60 * 1000;


function getClosedLabel(item) {
  const board = String(item?.board || item?.category || '').toUpperCase();
  if (board === 'EVENTS') return 'Ended';
  if (board === 'SERVICES' || board === 'WORK') return 'Completed';
  return 'Sold';
}

function getMarkClosedLabel(item) {
  const board = String(item?.board || item?.category || '').toUpperCase();
  if (board === 'EVENTS') return 'Mark Ended';
  if (board === 'SERVICES' || board === 'WORK') return 'Mark Completed';
  return 'Mark Sold';
}


window.addEventListener('error', (e) => {
  console.error('Marketplace JS error:', e.error || e.message || e);
});

document.addEventListener('DOMContentLoaded', () => {
  bindStaticEvents();
  renderBoards();
  renderListings();

  onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      currentUser = null;
      currentProfile = null;
      stopListeners();
      updateAuthUI();
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

    if (!currentProfile?.accessApproved && !isProtectedCoreAdmin(user.email)) {
      if ($('verifyNote')) {
        $('verifyNote').textContent = 'Your account has been created and is waiting for manual admin approval.';
        $('verifyNote').style.display = 'block';
      }
      if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';
      await signOut(auth);
      alert('Your account is waiting for manual admin approval.');
      return;
    }

    lastUnverifiedEmail = '';
    if ($('verifyNote')) $('verifyNote').style.display = 'none';
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';

    updateAuthUI();
    startListingsListener();
    startProfilesListener();
    startEventResponsesListener();
    touchPresence();
    if (!presenceTimer) presenceTimer = setInterval(touchPresence, PRESENCE_HEARTBEAT_MS);

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

function bindStaticEvents() {
  $('tabLogin')?.addEventListener('click', () => showPane('login'));
  $('tabSignup')?.addEventListener('click', () => showPane('signup'));

  $('btnLogin')?.addEventListener('click', handleLogin);
  $('btnForgotPassword')?.addEventListener('click', handleForgotPassword);
  $('btnSignup')?.addEventListener('click', handleSignup);
  $('btnResendVerify')?.addEventListener('click', handleResendVerification);
  $('btnSaveName')?.addEventListener('click', handleSaveName);
  $('btnEventAttend')?.addEventListener('click', () => handleEventRsvp('ATTENDING'));
  $('btnEventMaybe')?.addEventListener('click', () => handleEventRsvp('MAYBE'));
  $('btnEventCant')?.addEventListener('click', () => handleEventRsvp('CANT'));
  $('btnLogout')?.addEventListener('click', async () => {
    await signOut(auth);
  });

  const openPost = () => {
    if (!currentUser) {
      alert('Please log in first.');
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('btnSavePost')?.addEventListener('click', handleSavePost);
  $('btnSendReply')?.addEventListener('click', handleSendReply);

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => { const target = btn.dataset.close; if (target === 'postOverlay') resetPostEditor(); hide(target); });
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
    }
  });
}

function showPane(which) {
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
  const stillOpen = ['nameOverlay', 'postOverlay', 'threadOverlay'].some((overlayId) => $(overlayId)?.style.display !== 'none');
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
  if (eventResponsesUnsub) {
    eventResponsesUnsub();
    eventResponsesUnsub = null;
  }
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
    lastSeenAtMs: Date.now(),
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

    if (typeof currentProfile.isModerator !== 'boolean') updates.isModerator = false;
    if (typeof currentProfile.banned !== 'boolean') updates.banned = false;
    if (typeof currentProfile.manualVerified !== 'boolean') updates.manualVerified = false;
    if (typeof currentProfile.emailVerified !== 'boolean') updates.emailVerified = !!user.emailVerified;
    if (typeof currentProfile.accessApproved !== 'boolean') updates.accessApproved = isProtectedCoreAdmin(user.email) || isAdmin(user.email);
    if (typeof currentProfile.accessManuallyDenied !== 'boolean') updates.accessManuallyDenied = false;
    if (!Number.isFinite(Number(currentProfile.lastSeenAtMs || 0))) updates.lastSeenAtMs = Date.now();

    if (user.emailVerified && currentProfile.emailVerified !== true) {
      updates.emailVerified = true;
      updates.emailVerifiedAt = Date.now();
    }
        if (isProtectedCoreAdmin(user.email) && currentProfile.isAdmin !== true) {
      updates.isAdmin = true;
    }
    if (isProtectedCoreAdmin(user.email) && currentProfile.accessApproved !== true) {
      updates.accessApproved = true;
    }

    if (Object.keys(updates).length) {
      updates.updatedAt = serverTimestamp();
      await updateDoc(profileRef, updates);
      currentProfile = { ...currentProfile, ...updates };
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
  if ($('loginOverlay')) $('loginOverlay').style.display = loggedIn ? 'none' : 'flex';
}

async function handleLogin() {
  const email = $('loginEmail')?.value.trim().toLowerCase();
  const password = $('loginPassword')?.value || '';

  if (!email || !password) {
    alert('Enter email and password.');
    return;
  }
  if (!isAllowedEmail(email)) {
    alert('Use your @regallakeland.com email.');
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'login_error'} — ${err?.message || 'Login failed.'}`);
  }
}


async function handleForgotPassword() {
  const email = $('loginEmail')?.value.trim().toLowerCase();

  if (!email) {
    alert('Enter your work email first, then click Forgot Password.');
    $('loginEmail')?.focus();
    return;
  }
  if (!isAllowedEmail(email)) {
    alert('Use your @regallakeland.com email.');
    return;
  }

  try {
    applyAuthLanguage();
    await sendPasswordResetEmail(auth, email);
    alert('Password reset email sent. Check your inbox.');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'reset_error'} — ${err?.message || 'Could not send password reset email.'}`);
  }
}

async function handleSignup() {
  const fullName = $('signupName')?.value.trim() || '';
  const email = $('signupEmail')?.value.trim().toLowerCase();
  const password = $('signupPassword')?.value || '';
  const password2 = $('signupPassword2')?.value || '';
  const msg = $('signupMsg');

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

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const elevated = isProtectedCoreAdmin(email) || isAdmin(email);
    await setDoc(doc(db, 'profiles', cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName: fullName,
      pendingName: fullName,
      requestedName: fullName,
      isAdmin: isAdmin(email),
      isModerator: false,
      banned: false,
      manualVerified: elevated,
      emailVerified: !!cred.user.emailVerified,
      accessApproved: elevated,
      accessManuallyDenied: false,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await signOut(auth);

    if (msg) {
      msg.textContent = elevated
        ? 'Account created. You can sign in now.'
        : 'Account created. An admin must manually approve your account before you can sign in.';
      msg.style.display = 'block';
    }

    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginPassword')) $('loginPassword').value = '';
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';

    showPane('login');
    alert(elevated
      ? 'Account created. You can sign in now.'
      : 'Account created. An admin must manually approve your account before you can sign in.');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'signup_error'} — ${err?.message || 'Signup failed.'}`);
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


async function touchPresence() {
  if (!currentUser) return;
  const stamp = Date.now();
  try {
    await updateDoc(doc(db, 'profiles', currentUser.uid), {
      lastSeenAtMs: stamp,
      updatedAt: serverTimestamp()
    });
    if (currentProfile) currentProfile.lastSeenAtMs = stamp;
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
  const counts = featuredEventCounts();
  const mine = currentUserEventResponse();
  const canRsvp = canUseEventRsvp();
  if ($('eventImage')) $('eventImage').src = FEATURED_EVENT.imageUrl;
  if ($('eventAttendCount')) $('eventAttendCount').textContent = String(counts.ATTENDING || 0);
  if ($('eventMaybeCount')) $('eventMaybeCount').textContent = String(counts.MAYBE || 0);
  if ($('eventCantCount')) $('eventCantCount').textContent = String(counts.CANT || 0);
  if ($('eventStatusText')) {
    if (mine) {
      $('eventStatusText').textContent = `Your current response: ${RSVP_LABELS[mine.status] || mine.status}`;
    } else if (!currentUser) {
      $('eventStatusText').textContent = 'Log in with your Regal Lakeland email to RSVP.';
    } else if (!canRsvp) {
      $('eventStatusText').textContent = 'Your account can see the event, but RSVP is not ready until your employee profile finishes loading.';
    } else {
      $('eventStatusText').textContent = 'Choose your response below.';
    }
  }
  ['ATTENDING', 'MAYBE', 'CANT'].forEach((status) => {
    const btn = document.querySelector(`[data-rsvp="${status}"]`);
    if (!btn) return;
    btn.classList.toggle('active-rsvp', mine?.status === status);
    btn.disabled = !canRsvp;
    btn.title = canRsvp ? '' : 'Log in with your Regal Lakeland account to RSVP';
  });
}

async function handleEventRsvp(status) {
  if (!currentUser) {
    alert('Please log in first to RSVP.');
    return;
  }
  if (!currentProfile) {
    await ensureProfile(currentUser);
  }
  if (!canUseEventRsvp()) {
    alert('Your account is not ready to RSVP yet. Please refresh and try again.');
    return;
  }
  try {
    const responseRef = doc(db, 'eventResponses', `${FEATURED_EVENT.id}__${currentUser.uid}`);
    const payload = {
      eventId: FEATURED_EVENT.id,
      eventTitle: FEATURED_EVENT.title,
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      displayName: currentProfile.displayName || currentProfile.pendingName || currentUser.email || '',
      status,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    };
    await setDoc(responseRef, payload, { merge: true });
    const existingIndex = eventResponses.findIndex((item) => item.id === `${FEATURED_EVENT.id}__${currentUser.uid}`);
    const optimistic = { id: `${FEATURED_EVENT.id}__${currentUser.uid}`, ...payload };
    if (existingIndex >= 0) {
      eventResponses[existingIndex] = { ...eventResponses[existingIndex], ...optimistic };
    } else {
      eventResponses.unshift(optimistic);
    }
    renderEventSpotlight();
    if ($('eventStatusText')) $('eventStatusText').textContent = `Saved: ${RSVP_LABELS[status] || status}`;
  } catch (err) {
    console.error(err);
    if ($('eventStatusText')) $('eventStatusText').textContent = err?.message || 'Unable to save your RSVP right now.';
    alert(err?.message || 'Unable to save your RSVP right now.');
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

function startListingsListener() {
  if (listingsUnsub) return;

  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  listingsUnsub = onSnapshot(qRef, (snap) => {
    listings = snap.docs.map((d) => normalizeListing({ id: d.id, ...d.data() }));
    renderBoards();
    renderListings();
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
    reactivationRequested: !!item.reactivationRequested,
    featured: !!item.featured,
    hidden: !!item.hidden,
    status: String(item.status || 'ACTIVE').toUpperCase(),
    replies: Array.isArray(item.replies) ? item.replies : []
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

function canModify(item) {
  return !!currentUser && !!currentProfile && (canModerate() || currentUser.uid === item.uid);
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
    return;
  }

  empty.style.display = 'none';
  wrap.innerHTML = data.map((item) => {
    const statusClass = item.status === 'SOLD' ? 'sold' : item.reactivationRequested ? 'pending' : 'active';
    const statusText = item.reactivationRequested ? 'Reactivation Requested' : ((item.status === 'SOLD') ? getClosedLabel(item) : (item.status || 'ACTIVE'));
    const showRequestActive = isViewerAdmin() && item.status === 'SOLD' && currentUser && currentUser.uid === item.uid && !item.reactivationRequested;
    const requestPending = item.status === 'SOLD' && item.reactivationRequested && currentUser && currentUser.uid === item.uid;
    const featuredPill = item.featured ? `<span class="status featured">Featured</span>` : '';
    return `
      <article class="topicRow">
        <div class="topicMain">
          <div class="topicHeader">
            <div class="topicTitle">${esc(item.title || 'Untitled')}</div>
            <span class="status ${statusClass}">${esc(statusText)}</span>${featuredPill}
          </div>
          <div class="topicMeta">
            <span>${esc(BOARD_DEFS.find((b) => b.key === item.board)?.label || item.board)}</span>
            <span>${esc(item.authorName || item.authorEmail || '')}</span>
            <span>${esc(formatDate(item.createdAtMs))}</span>
          </div>
          <div class="topicDesc">${esc(item.description || '').slice(0, 220)}${(item.description || '').length > 220 ? '…' : ''}</div>
          <div class="rowBtns">
            <button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open</button>
            ${canModify(item) ? `<button class="btn ghost" data-action="editPost" data-id="${esc(item.id)}" type="button">Edit</button>` : ''}
            ${canModify(item) && item.status !== 'SOLD' ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">${esc(getMarkClosedLabel(item))}</button>` : ''}
            ${showRequestActive ? `<button class="btn ghost" data-action="requestActive" data-id="${esc(item.id)}" type="button">Request Active</button>` : ''}
            ${requestPending ? `<span class="pill">Awaiting admin review</span>` : ''}
          </div>
        </div>
        <div class="topicSide">
          <div class="topicSideTop">
            <div class="price">${esc(formatPrice(item.price))}</div>
            ${item.imageUrl ? `<img class="topicThumb" src="${esc(item.imageUrl)}" alt="${esc(item.title)}" />` : ''}
          </div>
          <div class="topicMeta topicMetaRight">
            <span>${esc(item.location || 'No location')}</span>
            <span>${esc(item.contact || 'No contact')}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function handleSavePost() {
  if (isSavingPost) return;
  if (!currentUser || !currentProfile) {
    alert('Please log in first.');
    return;
  }

  const title = $('fTitle')?.value.trim();
  const description = $('fDesc')?.value.trim();
  const board = $('fBoard')?.value || 'BUYSELL';
  const status = $('fStatus')?.value || 'ACTIVE';
  const location = $('fLocation')?.value.trim() || '';
  const contact = $('fContact')?.value.trim() || '';
  const priceRaw = $('fPrice')?.value.trim() || '';
  const file = $('fPhoto')?.files?.[0] || null;

  if (!title) {
    alert('Enter a title.');
    return;
  }
  if (!description) {
    alert('Enter a description.');
    return;
  }

  let imageUrl = '';
  isSavingPost = true;
  if ($('btnSavePost')) $('btnSavePost').disabled = true;
  try {
    if (editingPostId) {
      const existing = listings.find((x) => x.id === editingPostId);
      if (!existing || !canModify(existing)) {
        alert('You do not have permission to edit this post.');
        return;
      }
      imageUrl = existing.imageUrl || existing.photo || '';
    }
    if (file) {
      const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
      await uploadBytes(storageRef, file);
      imageUrl = await getDownloadURL(storageRef);
    }

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
      updatedAt: serverTimestamp()
    };

    if (editingPostId) {
      await updateDoc(doc(db, 'listings', editingPostId), payload);
    } else {
      await addDoc(collection(db, 'listings'), {
        uid: currentUser.uid,
        userEmail: currentUser.email || '',
        displayName: currentProfile.displayName || currentUser.email || '',
        ...payload,
        replies: [],
        featured: false,
        hidden: false,
        reactivationRequested: false,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
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

function clearPostForm() {
  ['fTitle', 'fDesc', 'fLocation', 'fContact', 'fPrice'].forEach((id) => {
    if ($(id)) $(id).value = '';
  });
  if ($('fBoard')) $('fBoard').value = 'FREE';
  if ($('fStatus')) $('fStatus').value = 'ACTIVE';
  if ($('fPhoto')) $('fPhoto').value = '';
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
  const item = listings.find((x) => x.id === id);
  if (!item) return;

  activeThread = item;
  if ($('threadTitle')) $('threadTitle').textContent = item.title || 'Thread';
  if ($('threadMeta')) {
    $('threadMeta').textContent = `${BOARD_DEFS.find((b) => b.key === item.board)?.label || item.board} | ${item.authorName || item.authorEmail || ''} | ${formatDate(item.createdAtMs)}`;
  }

  if ($('threadBody')) {
    $('threadBody').innerHTML = `
      <div class="thread-body-grid">
        ${item.imageUrl ? `<img class="thread-card-image" src="${esc(item.imageUrl)}" alt="${esc(item.title)}" />` : ''}
        <div>${esc(item.description || '')}</div>
        <div class="topicMeta">
          <span>${esc(item.location || 'No location')}</span>
          <span>${esc(item.contact || 'No contact')}</span>
          <span>${esc(formatPrice(item.price))}</span>
        </div>
      </div>
    `;
  }

  renderReplies(item.replies || []);
  if ($('replyText')) $('replyText').value = '';
  show('threadOverlay');
}

function renderReplies(replies) {
  const wrap = $('threadReplies');
  if (!wrap) return;
  if (!replies.length) {
    wrap.innerHTML = '<div class="note">No replies yet. Be the first to respond.</div>';
    return;
  }
  wrap.innerHTML = replies.map((r) => `
    <div class="replyItem">
      <div class="replyTop">
        <div class="replyUser">${esc(r.displayName || r.userEmail || 'Unknown')}</div>
        <div class="replyTime">${esc(formatDate(r.createdAtMs || r.createdAt))}</div>
      </div>
      <div>${esc(r.text || '')}</div>
    </div>
  `).join('');
}

async function handleSendReply() {
  if (!currentUser || !currentProfile || !activeThread) {
    alert('Open a thread first.');
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
  const data = snap.data();
  const replies = Array.isArray(data.replies) ? data.replies.slice() : [];
  replies.push({
    uid: currentUser.uid,
    userEmail: currentUser.email || '',
    displayName: currentProfile.displayName || currentUser.email || '',
    text,
    createdAtMs: Date.now()
  });

  try {
    await updateDoc(listingRef, { replies, updatedAt: serverTimestamp() });
    if ($('replyText')) $('replyText').value = '';
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to send reply.');
  }
}
