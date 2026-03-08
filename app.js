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
let lastUnverifiedEmail = '';

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
      if (!user.emailVerified) {
        lastUnverifiedEmail = user.email || '';
        if ($('verifyNote')) $('verifyNote').style.display = 'block';
        if ($('btnResendVerify')) $('btnResendVerify').style.display = 'inline-flex';
        await signOut(auth);
        alert('Please verify your email before logging in.');
        return;
      }

      currentUser = user;
      lastUnverifiedEmail = '';
      if ($('verifyNote')) $('verifyNote').style.display = 'none';
      if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';

      await ensureProfile(user);
      if (currentProfile?.banned) {
        alert('Your marketplace access has been disabled. Contact an admin.');
        await signOut(auth);
        return;
      }

      updateAuthUI();
      startListingsListener();

      if (!currentProfile?.displayName) {
        if ($('displayNameInput')) $('displayNameInput').value = user.displayName || '';
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
  $('btnResendVerify')?.addEventListener('click', handleResendVerification);
  $('btnSaveName')?.addEventListener('click', handleSaveName);
  $('btnLogout')?.addEventListener('click', async () => {
    await signOut(auth);
  });

  const openPost = () => {
    if (!currentUser) {
      alert('Please log in first.');
      return;
    }
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
    btn.addEventListener('click', () => hide(btn.dataset.close));
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

function isAdmin(email) {
  return ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(String(email || '').trim().toLowerCase());
}

function stopListeners() {
  if (listingsUnsub) {
    listingsUnsub();
    listingsUnsub = null;
  }
  listings = [];
  activeThread = null;
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
    banned: false,
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
    if (currentProfile.isAdmin !== isAdmin(user.email)) {
      await updateDoc(profileRef, {
        isAdmin: isAdmin(user.email),
        updatedAt: serverTimestamp()
      });
      currentProfile.isAdmin = isAdmin(user.email);
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

  if ($('adminLink')) $('adminLink').style.display = loggedIn && currentProfile.isAdmin ? 'inline-flex' : 'none';
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

async function handleSignup() {
  const email = $('signupEmail')?.value.trim().toLowerCase();
  const password = $('signupPassword')?.value || '';
  const password2 = $('signupPassword2')?.value || '';
  const msg = $('signupMsg');

  if (msg) {
    msg.style.display = 'none';
    msg.textContent = '';
  }

  if (!email || !password || !password2) {
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
    await sendEmailVerification(cred.user);
    await signOut(auth);

    if (msg) {
      msg.textContent = 'Account created. Check your email and click the verification link, then log in.';
      msg.style.display = 'block';
    }

    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginPassword')) $('loginPassword').value = '';

    lastUnverifiedEmail = email;
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'inline-flex';

    showPane('login');
    alert('Account created. Verification email sent.');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'signup_error'} — ${err?.message || 'Signup failed.'}`);
  }
}

async function handleResendVerification() {
  const email = (lastUnverifiedEmail || $('loginEmail')?.value || '').trim().toLowerCase();
  if (!email) {
    alert('Enter your email first.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    alert('Check your email. If your account exists, a message was sent.');
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to send email right now.');
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
    replies: Array.isArray(item.replies) ? item.replies : []
  };
}

function boardCounts() {
  const counts = { ALL: listings.length };
  BOARD_DEFS.forEach((b) => { if (b.key !== 'ALL') counts[b.key] = 0; });
  listings.forEach((item) => { counts[item.board] = (counts[item.board] || 0) + 1; });
  return counts;
}

function latestForBoard(boardKey) {
  const list = listings.filter((item) => boardKey === 'ALL' || item.board === boardKey);
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
  const st = $('st')?.value || 'ACTIVE';
  const sort = $('sort')?.value || 'NEW';

  let data = listings.filter((item) => activeBoard === 'ALL' || item.board === activeBoard);

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
  return !!currentUser && !!currentProfile && (currentProfile.isAdmin || currentUser.uid === item.uid);
}

function renderListings() {
  const wrap = $('cards');
  const empty = $('empty');
  if (!wrap || !empty) return;

  const data = filteredListings();
  const latest = data[0] || listings[0] || null;

  if ($('feedTitle')) $('feedTitle').textContent = BOARD_DEFS.find((b) => b.key === activeBoard)?.label || 'All Boards';
  if ($('boardPill')) $('boardPill').textContent = BOARD_DEFS.find((b) => b.key === activeBoard)?.label || 'All';
  if ($('countLine')) $('countLine').textContent = `${data.length} shown | ${listings.length} total`;
  if ($('heroListingCount')) $('heroListingCount').textContent = String(listings.length);
  if ($('heroRecentText')) $('heroRecentText').textContent = latest ? latest.title : 'Waiting for new posts';

  if (!data.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  wrap.innerHTML = data.map((item) => {
    const statusClass = item.status === 'SOLD' ? 'sold' : item.reactivationRequested ? 'pending' : 'active';
    const statusText = item.reactivationRequested ? 'Reactivation Requested' : (item.status || 'ACTIVE');
    const showRequestActive = item.status === 'SOLD' && currentUser && currentUser.uid === item.uid && !item.reactivationRequested;
    const requestPending = item.status === 'SOLD' && item.reactivationRequested && currentUser && currentUser.uid === item.uid;
    return `
      <article class="topicRow">
        <div class="topicMain">
          <div class="topicHeader">
            <div class="topicTitle">${esc(item.title || 'Untitled')}</div>
            <span class="status ${statusClass}">${esc(statusText)}</span>
          </div>
          <div class="topicMeta">
            <span>${esc(BOARD_DEFS.find((b) => b.key === item.board)?.label || item.board)}</span>
            <span>${esc(item.authorName || item.authorEmail || '')}</span>
            <span>${esc(formatDate(item.createdAtMs))}</span>
          </div>
          <div class="topicDesc">${esc(item.description || '').slice(0, 220)}${(item.description || '').length > 220 ? '…' : ''}</div>
          <div class="rowBtns">
            <button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open</button>
            ${canModify(item) && item.status !== 'SOLD' ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">Mark Sold</button>` : ''}
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
  try {
    if (file) {
      const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
      await uploadBytes(storageRef, file);
      imageUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, 'listings'), {
      uid: currentUser.uid,
      userEmail: currentUser.email || '',
      displayName: currentProfile.displayName || currentUser.email || '',
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
      replies: [],
      reactivationRequested: false,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: serverTimestamp()
    });

    clearPostForm();
    hide('postOverlay');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'post_error'} — ${err?.message || 'Unable to create post.'}`);
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
