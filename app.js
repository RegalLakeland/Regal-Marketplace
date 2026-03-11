import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword
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


const $ = (id) => document.getElementById(id);

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

let currentUser = null;
let currentProfile = null;
let listings = [];
let activeBoard = 'ALL';
let activeThread = null;
let listingsUnsub = null;
let profilesUnsub = null;
let presenceTimer = null;
let profiles = [];
let lastUnverifiedEmail = '';
let passwordGateRequired = false;
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
        passwordGateRequired = false;
        stopListeners();
        updateAuthUI();
        hide('passwordGateOverlay');
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

      if (!currentProfile?.accessApproved && !isProtectedCoreAdmin(user.email)) {
        if ($('verifyNote')) {
          $('verifyNote').textContent = 'Your account is waiting for admin approval. Please check back later.';
          $('verifyNote').style.display = 'block';
        }
        await signOut(auth);
        alert('Your account is waiting for admin approval.');
        return;
      }

      lastUnverifiedEmail = '';
      if ($('verifyNote')) $('verifyNote').style.display = 'none';

      passwordGateRequired = !!currentProfile?.mustChangePassword || !!currentProfile?.tempPasswordActive;
      updateAuthUI();
      startListingsListener();
      startProfilesListener();
      touchPresence();
      if (!presenceTimer) presenceTimer = setInterval(touchPresence, PRESENCE_HEARTBEAT_MS);

      if (passwordGateRequired) {
        if ($('newPasswordInput')) $('newPasswordInput').value = '';
        if ($('confirmNewPasswordInput')) $('confirmNewPasswordInput').value = '';
        if ($('passwordGateMsg')) $('passwordGateMsg').style.display = 'none';
        hide('nameOverlay');
        show('passwordGateOverlay');
        return;
      }

      hide('passwordGateOverlay');
      if (!currentProfile?.displayName) {
        if ($('displayNameInput')) $('displayNameInput').value = user.displayName || currentProfile?.name || '';
        show('nameOverlay');
      } else {
        hide('nameOverlay');
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Authentication error.');
    }
  });
});

function bindStaticEvents() {
  $('tabLogin')?.addEventListener('click', () => showPane('login'));
  $('tabSignup')?.addEventListener('click', () => showPane('signup'));

  $('btnLogin')?.addEventListener('click', handleLogin);
  $('btnSignup')?.addEventListener('click', handleSignup);
  $('btnSaveName')?.addEventListener('click', handleSaveName);
  $('btnCompletePasswordReset')?.addEventListener('click', handleCompletePasswordReset);
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
  const stillOpen = ['nameOverlay', 'passwordGateOverlay', 'postOverlay', 'threadOverlay'].some((overlayId) => $(overlayId)?.style.display !== 'none');
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
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  listings = [];
  profiles = [];
  activeThread = null;
  updateHeroPeopleStats();
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
    isAdmin: isAdmin(user.email),
    isModerator: false,
    banned: false,
    manualVerified: false,
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
    if (typeof currentProfile.accessApproved !== 'boolean') updates.accessApproved = true;
    if (typeof currentProfile.accessManuallyDenied !== 'boolean') updates.accessManuallyDenied = false;
    if (!Number.isFinite(Number(currentProfile.lastSeenAtMs || 0))) updates.lastSeenAtMs = Date.now();

    if (user.emailVerified && currentProfile.emailVerified !== true) {
      updates.emailVerified = true;
      updates.emailVerifiedAt = Date.now();
    }
    if ((user.emailVerified || currentProfile.manualVerified === true) && currentProfile.accessApproved !== true && currentProfile.accessManuallyDenied !== true) {
      updates.accessApproved = true;
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
  document.body.classList.toggle('password-gate-open', loggedIn && passwordGateRequired);
  if ($('adminLink')) $('adminLink').style.display = showAdmin ? 'inline-flex' : 'none';
  if ($('btnLogout')) $('btnLogout').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('btnNew')) $('btnNew').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('loginOverlay')) $('loginOverlay').style.display = loggedIn ? 'none' : 'flex';
  if (!loggedIn) hide('passwordGateOverlay');
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

async function handleSignup() {
  const fullName = $('signupFullName')?.value.trim() || '';
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
    await setDoc(doc(db, 'profiles', cred.user.uid), {
      uid: cred.user.uid,
      email,
      name: fullName,
      displayName: fullName,
      isAdmin: isAdmin(email),
      isModerator: false,
      banned: false,
      manualVerified: false,
      emailVerified: false,
      accessApproved: isProtectedCoreAdmin(email) || isAdmin(email),
      accessManuallyDenied: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await signOut(auth);

    if (msg) {
      msg.textContent = 'Account created. An admin must approve access before you can sign in.';
      msg.style.display = 'block';
    }

    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginPassword')) $('loginPassword').value = '';
    showPane('login');
    alert('Account created. Admin approval is required before first sign-in.');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'signup_error'} — ${err?.message || 'Signup failed.'}`);
  }
}


async function handleCompletePasswordReset() {
  if (!currentUser || !currentProfile) {
    alert('Please log in again.');
    return;
  }

  const newPassword = $('newPasswordInput')?.value || '';
  const confirmPassword = $('confirmNewPasswordInput')?.value || '';
  const msg = $('passwordGateMsg');

  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
  }

  if (!newPassword || !confirmPassword) {
    alert('Enter and confirm the new password.');
    return;
  }
  if (newPassword.length < 6) {
    alert('New password must be at least 6 characters.');
    return;
  }
  if (newPassword !== confirmPassword) {
    alert('New passwords do not match.');
    return;
  }

  try {
    await updatePassword(currentUser, newPassword);
    await updateDoc(doc(db, 'profiles', currentUser.uid), {
      mustChangePassword: false,
      tempPasswordActive: false,
      updatedAt: serverTimestamp()
    });
    currentProfile = {
      ...currentProfile,
      mustChangePassword: false,
      tempPasswordActive: false
    };
    passwordGateRequired = false;
    hide('passwordGateOverlay');
    updateAuthUI();
    if (!currentProfile?.displayName) {
      show('nameOverlay');
    }
    alert('Password updated successfully.');
  } catch (err) {
    console.error(err);
    if (msg) {
      msg.textContent = err?.message || 'Unable to update password right now.';
      msg.style.display = 'block';
    } else {
      alert(err?.message || 'Unable to update password right now.');
    }
  }
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
