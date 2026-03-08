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

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const boardLabels = {
  ALL: 'All Boards',
  FREE: 'Free Items',
  BUYSELL: 'Buy / Sell',
  GARAGE: 'Garage Sales',
  EVENTS: 'Events',
  WORK: 'Work News',
  SERVICES: 'Local Services'
};

const boardDescriptions = {
  FREE: 'Giveaways, curb alerts, and free pickups.',
  BUYSELL: 'Employee items for sale and trade.',
  GARAGE: 'Yard sales, moving sales, and weekend setups.',
  EVENTS: 'Cookouts, meetups, birthdays, and local events.',
  WORK: 'Dealership announcements and team updates.',
  SERVICES: 'Side work, repair help, and local recommendations.'
};

let currentUser = null;
let currentProfile = null;
let listings = [];
let listingsUnsub = null;
let repliesUnsub = null;
let activeBoard = 'ALL';
let activeThread = null;
let lastUnverifiedEmail = '';

function getBoardKey(item){
  return item.board || item.category || 'BUYSELL';
}

function isAllowedEmail(email){
  return String(email || '').trim().toLowerCase().endsWith('@regallakeland.com');
}

function isAdmin(email){
  return ADMIN_EMAILS.map((x) => String(x).toLowerCase()).includes(String(email || '').trim().toLowerCase());
}

function show(id){
  const el = $(id);
  if (el) el.style.display = 'flex';
  if (id !== 'loginOverlay') document.body.classList.add('modal-open');
}

function hide(id){
  const el = $(id);
  if (el) el.style.display = 'none';
  const openOverlay = ['postOverlay', 'threadOverlay', 'nameOverlay'].some((overlayId) => $(overlayId)?.style.display !== 'none');
  if (!openOverlay) document.body.classList.remove('modal-open');
}

function showPane(which){
  const loginPane = $('loginPane');
  const signupPane = $('signupPane');
  const tabLogin = $('tabLogin');
  const tabSignup = $('tabSignup');
  if (!loginPane || !signupPane || !tabLogin || !tabSignup) return;

  const loginActive = which === 'login';
  loginPane.style.display = loginActive ? 'block' : 'none';
  signupPane.style.display = loginActive ? 'none' : 'block';
  tabLogin.classList.toggle('active', loginActive);
  tabSignup.classList.toggle('active', !loginActive);
}

function fmtPrice(value){
  const n = Number(value || 0);
  if (!n) return 'Free';
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(n);
}

function fmtDate(ms){
  try{ return new Date(Number(ms || Date.now())).toLocaleString(); }
  catch{ return '—'; }
}

function canModify(item){
  return !!currentUser && !!currentProfile && (currentProfile.isAdmin || currentUser.uid === item.uid);
}

function applyVisibilityUI(){
  const loggedIn = !!currentUser && !!currentProfile;
  document.body.classList.toggle('auth-open', !loggedIn);
  if ($('pillUser')) $('pillUser').textContent = loggedIn ? (currentProfile.displayName || currentUser.email) : 'Not signed in';
  if ($('adminLink')) $('adminLink').style.display = loggedIn && currentProfile.isAdmin ? 'inline-flex' : 'none';
  if ($('btnLogout')) $('btnLogout').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('btnNew')) $('btnNew').style.display = loggedIn ? 'inline-flex' : 'none';
  if ($('loginOverlay')) $('loginOverlay').style.display = loggedIn ? 'none' : 'flex';
}

async function ensureProfile(user){
  const refDoc = doc(db, 'profiles', user.uid);
  const snap = await getDoc(refDoc);
  const next = {
    uid:user.uid,
    email:user.email || '',
    displayName:(user.displayName || '').trim(),
    isAdmin:isAdmin(user.email),
    banned:false,
    updatedAt:serverTimestamp()
  };

  if (!snap.exists()) {
    await setDoc(refDoc, { ...next, createdAt:serverTimestamp() });
    currentProfile = { ...next, createdAt:Date.now() };
  } else {
    currentProfile = { id:snap.id, ...snap.data() };
    if (currentProfile.isAdmin !== isAdmin(user.email)) {
      await updateDoc(refDoc, { isAdmin:isAdmin(user.email), updatedAt:serverTimestamp() });
      currentProfile.isAdmin = isAdmin(user.email);
    }
  }
}

function stopListeners(){
  if (listingsUnsub) { listingsUnsub(); listingsUnsub = null; }
  if (repliesUnsub) { repliesUnsub(); repliesUnsub = null; }
  listings = [];
  activeThread = null;
  renderBoards();
  renderListings();
}

function bindStaticEvents(){
  $('tabLogin')?.addEventListener('click', () => showPane('login'));
  $('tabSignup')?.addEventListener('click', () => showPane('signup'));
  $('btnLogin')?.addEventListener('click', handleLogin);
  $('btnSignup')?.addEventListener('click', handleSignup);
  $('btnResendVerify')?.addEventListener('click', handleResendVerification);
  $('btnSaveName')?.addEventListener('click', handleSaveName);
  $('btnLogout')?.addEventListener('click', async () => { await signOut(auth); });

  const openPost = () => {
    if (!currentUser) return alert('Please log in first.');
    show('postOverlay');
  };
  $('btnNew')?.addEventListener('click', openPost);
  $('heroPostBtn')?.addEventListener('click', openPost);
  $('heroFreeBtn')?.addEventListener('click', () => {
    activeBoard = 'FREE';
    renderBoards();
    renderListings();
    document.querySelector('.feedPanel')?.scrollIntoView({ behavior:'smooth', block:'start' });
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
    const id = actionEl.dataset.id;
    if (!id) return;

    switch (actionEl.dataset.action) {
      case 'openThread': await openThread(id); break;
      case 'deletePost': await handleDeletePost(id); break;
      case 'markSold': await handleMarkSold(id); break;
      case 'requestReactivation': await handleRequestReactivation(id); break;
    }
  });
}

async function handleLogin(){
  const email = $('loginEmail')?.value.trim().toLowerCase();
  const password = $('loginPassword')?.value || '';
  if (!email || !password) return alert('Enter email and password.');
  if (!isAllowedEmail(email)) return alert('Use your @regallakeland.com email.');
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'login_error'} | ${err?.message || 'Login failed.'}`);
  }
}

async function handleSignup(){
  const email = $('signupEmail')?.value.trim().toLowerCase();
  const password = $('signupPassword')?.value || '';
  const password2 = $('signupPassword2')?.value || '';
  const msg = $('signupMsg');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  if (!email || !password || !password2) return alert('Complete all signup fields.');
  if (!isAllowedEmail(email)) return alert('Use your @regallakeland.com email.');
  if (password.length < 6) return alert('Password must be at least 6 characters.');
  if (password !== password2) return alert('Passwords do not match.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user);
    await signOut(auth);
    lastUnverifiedEmail = email;
    if (msg) {
      msg.textContent = 'Account created. Check your email and click the verification link, then log in.';
      msg.style.display = 'block';
    }
    if ($('loginEmail')) $('loginEmail').value = email;
    if ($('loginPassword')) $('loginPassword').value = '';
    if ($('btnResendVerify')) $('btnResendVerify').style.display = 'inline-flex';
    showPane('login');
    alert('Account created. Verification email sent.');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'signup_error'} | ${err?.message || 'Signup failed.'}`);
  }
}

async function handleResendVerification(){
  const email = (lastUnverifiedEmail || $('loginEmail')?.value || '').trim().toLowerCase();
  if (!email) return alert('Enter your email first.');
  try {
    await sendPasswordResetEmail(auth, email);
    alert('Check your email. If your account exists, a message was sent.');
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to send email right now.');
  }
}

async function handleSaveName(){
  const name = $('displayNameInput')?.value.trim();
  if (!currentUser) return alert('Please log in again.');
  if (!name) return alert('Enter your name.');
  await updateDoc(doc(db, 'profiles', currentUser.uid), { displayName:name, updatedAt:serverTimestamp() });
  currentProfile.displayName = name;
  applyVisibilityUI();
  hide('nameOverlay');
}

function startListingsListener(){
  if (listingsUnsub) return;
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  listingsUnsub = onSnapshot(qRef, (snap) => {
    listings = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderBoards();
    renderListings();
    updateHeroStats();
  }, (err) => {
    console.error(err);
    alert(`Listings error: ${err?.message || err}`);
  });
}

function boardCounts(){
  const counts = { ALL:listings.length };
  Object.keys(boardLabels).forEach((key) => { if (key !== 'ALL') counts[key] = 0; });
  listings.forEach((item) => {
    const key = getBoardKey(item);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function updateHeroStats(){
  const counts = boardCounts();
  if ($('heroBoardCount')) $('heroBoardCount').textContent = String(Object.keys(boardLabels).length - 1);
  if ($('heroListingCount')) $('heroListingCount').textContent = String(listings.length);
  if ($('heroRecentText')) {
    const latest = listings[0];
    $('heroRecentText').textContent = latest ? `${latest.title || 'Untitled'} | ${latest.authorName || latest.displayName || latest.userEmail || ''}` : 'Waiting for new posts';
  }
}

function renderBoards(){
  const wrap = $('boards');
  if (!wrap) return;
  const counts = boardCounts();
  wrap.innerHTML = Object.entries(boardLabels)
    .filter(([key]) => key !== 'ALL')
    .map(([key, label]) => `
      <button class="boardBtn ${activeBoard === key ? 'active' : ''}" data-board="${key}" type="button">
        <div>
          <div style="font-weight:950">${esc(label)}</div>
          <div class="boardDesc">${esc(boardDescriptions[key] || '')}</div>
        </div>
        <div class="boardCount">${counts[key] || 0}</div>
      </button>
    `).join('');

  wrap.querySelectorAll('.boardBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeBoard = btn.dataset.board;
      renderBoards();
      renderListings();
    });
  });

  if ($('boardPill')) $('boardPill').textContent = activeBoard === 'ALL' ? 'All Boards' : (boardLabels[activeBoard] || 'All Boards');
}

function filteredListings(){
  const q = $('q')?.value.trim().toLowerCase() || '';
  const st = $('st')?.value || 'ALL';
  const sort = $('sort')?.value || 'NEW';
  let data = listings.filter((item) => activeBoard === 'ALL' || getBoardKey(item) === activeBoard);

  if (st === 'ACTIVE') data = data.filter((item) => (item.status || 'ACTIVE') !== 'SOLD');
  if (st === 'SOLD') data = data.filter((item) => (item.status || 'ACTIVE') === 'SOLD');

  if (q) {
    data = data.filter((item) => {
      const hay = [item.title, item.description || item.desc, item.location, item.contact, item.authorName || item.displayName, item.authorEmail || item.userEmail]
        .join(' ')
        .toLowerCase();
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

function renderListings(){
  const wrap = $('cards');
  const empty = $('empty');
  if (!wrap || !empty) return;
  const data = filteredListings();
  if ($('feedTitle')) $('feedTitle').textContent = activeBoard === 'ALL' ? 'All Boards' : (boardLabels[activeBoard] || 'All Boards');
  if ($('countLine')) $('countLine').textContent = `${data.length} shown | ${listings.length} total`;
  if (!data.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  wrap.innerHTML = data.map((item) => {
    const boardKey = getBoardKey(item);
    const title = item.title || 'Untitled';
    const description = item.description || item.desc || '';
    const authorName = item.authorName || item.displayName || item.authorEmail || item.userEmail || '';
    const imageUrl = item.imageUrl || item.photo || '';
    const sold = (item.status || 'ACTIVE') === 'SOLD';
    return `
      <article class="topicRow ${sold ? 'isSold' : ''}">
        <div class="topicThumbWrap">
          ${imageUrl ? `<img class="topicThumb" src="${esc(imageUrl)}" alt="${esc(title)}" />` : `<div class="topicThumb placeholder">${esc((boardLabels[boardKey] || boardKey).slice(0,2))}</div>`}
        </div>
        <div class="topicBody">
          <div class="topicTop">
            <div>
              <div class="topicTitle">${esc(title)}</div>
              <div class="meta">${esc(boardLabels[boardKey] || boardKey)} | ${esc(authorName)} | ${esc(fmtDate(item.createdAtMs))}</div>
            </div>
            <div class="topicSide">
              <div class="price">${esc(fmtPrice(item.price))}</div>
              <span class="status ${sold ? 'sold' : 'active'}">${sold ? (item.reactivationRequested ? 'SOLD | Request Pending' : 'SOLD') : 'ACTIVE'}</span>
            </div>
          </div>
          <div class="topicExcerpt">${esc(description)}</div>
          <div class="topicMetaRow meta">
            <span>${esc(item.location || 'No location')}</span>
            <span>${esc(item.contact || 'No contact')}</span>
          </div>
        </div>
        <div class="topicActions">
          <button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open</button>
          ${canModify(item) && !sold ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">Mark Sold</button>` : ''}
          ${canModify(item) && sold && !item.reactivationRequested ? `<button class="btn ghost" data-action="requestReactivation" data-id="${esc(item.id)}" type="button">Request Active</button>` : ''}
          ${canModify(item) && item.reactivationRequested ? `<span class="pill request-pill">Active request pending</span>` : ''}
          ${canModify(item) ? `<button class="btn danger" data-action="deletePost" data-id="${esc(item.id)}" type="button">Delete</button>` : ''}
        </div>
      </article>`;
  }).join('');
}

async function handleSavePost(){
  if (!currentUser || !currentProfile) return alert('Please log in first.');
  const title = $('fTitle')?.value.trim();
  const description = $('fDesc')?.value.trim();
  const board = $('fBoard')?.value || 'BUYSELL';
  const status = $('fStatus')?.value || 'ACTIVE';
  const location = $('fLocation')?.value.trim() || '';
  const contact = $('fContact')?.value.trim() || '';
  const priceRaw = $('fPrice')?.value.trim() || '';
  const file = $('fPhoto')?.files?.[0] || null;
  if (!title) return alert('Enter a title.');
  if (!description) return alert('Enter a description.');

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
      authorEmail: currentUser.email || '',
      authorName: currentProfile.displayName || currentUser.email || '',
      displayName: currentProfile.displayName || currentUser.email || '',
      userEmail: currentUser.email || '',
      board,
      category: board,
      status,
      title,
      description,
      desc: description,
      location,
      contact,
      price: Number(priceRaw || 0),
      imageUrl,
      photo: imageUrl,
      reactivationRequested:false,
      createdAt:serverTimestamp(),
      createdAtMs:Date.now(),
      updatedAt:serverTimestamp()
    });
    ['fTitle','fDesc','fLocation','fContact','fPrice'].forEach((id) => { if ($(id)) $(id).value = ''; });
    if ($('fBoard')) $('fBoard').value = 'FREE';
    if ($('fStatus')) $('fStatus').value = 'ACTIVE';
    if ($('fPhoto')) $('fPhoto').value = '';
    hide('postOverlay');
  } catch (err) {
    console.error(err);
    alert(`${err?.code || 'post_error'} | ${err?.message || 'Unable to create post.'}`);
  }
}

async function handleDeletePost(id){
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  try {
    await deleteDoc(doc(db, 'listings', id));
    if (activeThread?.id === id) hide('threadOverlay');
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to delete post.');
  }
}

async function handleMarkSold(id){
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  try {
    await updateDoc(doc(db, 'listings', id), {
      status:'SOLD',
      reactivationRequested:false,
      reactivationRequestedAt:null,
      updatedAt:serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to update post.');
  }
}

async function handleRequestReactivation(id){
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item) || (item.status || 'ACTIVE') !== 'SOLD') return;
  try {
    await updateDoc(doc(db, 'listings', id), {
      reactivationRequested:true,
      reactivationRequestedAt:Date.now(),
      updatedAt:serverTimestamp()
    });
    alert('Reactivation request sent to admin.');
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to request reactivation.');
  }
}

async function openThread(id){
  const item = listings.find((x) => x.id === id);
  if (!item) return;
  activeThread = item;
  const boardKey = getBoardKey(item);
  const imageUrl = item.imageUrl || item.photo || '';
  const description = item.description || item.desc || '';
  const authorName = item.authorName || item.displayName || item.authorEmail || item.userEmail || '';
  if ($('threadTitle')) $('threadTitle').textContent = item.title || 'Thread';
  if ($('threadMeta')) $('threadMeta').textContent = `${boardLabels[boardKey] || boardKey} | ${authorName} | ${fmtDate(item.createdAtMs)}`;
  if ($('threadBody')) {
    $('threadBody').innerHTML = `
      ${imageUrl ? `<img class="thread-img" src="${esc(imageUrl)}" alt="${esc(item.title)}" />` : ''}
      <div>${esc(description)}</div>
      <div class="meta">Location: ${esc(item.location || '-')} | Contact: ${esc(item.contact || '-')} | Price: ${esc(fmtPrice(item.price))}</div>
      ${item.reactivationRequested ? '<div class="note">Reactivation requested and waiting on admin review.</div>' : ''}
    `;
  }
  if ($('threadReplies')) $('threadReplies').innerHTML = '<div class="note">Loading replies...</div>';
  if ($('replyText')) $('replyText').value = '';
  show('threadOverlay');
  if (repliesUnsub) repliesUnsub();
  const qRef = query(collection(db, 'listings', id, 'replies'), orderBy('createdAtMs', 'asc'));
  repliesUnsub = onSnapshot(qRef, (snap) => {
    const replies = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderReplies(replies);
  }, () => {
    if ($('threadReplies')) $('threadReplies').innerHTML = '<div class="note">Unable to load replies.</div>';
  });
}

function renderReplies(replies){
  const wrap = $('threadReplies');
  if (!wrap) return;
  if (!replies.length) {
    wrap.innerHTML = '<div class="note">No replies yet.</div>';
    return;
  }
  wrap.innerHTML = replies.map((r) => `
    <div class="reply">
      <div class="reply-top">
        <strong>${esc(r.authorName || r.displayName || r.authorEmail || r.userEmail || 'Unknown')}</strong>
        <span class="meta">${esc(fmtDate(r.createdAtMs))}</span>
      </div>
      <div>${esc(r.text || '')}</div>
    </div>`).join('');
}

async function handleSendReply(){
  if (!currentUser || !currentProfile || !activeThread) return alert('Open a thread first.');
  const text = $('replyText')?.value.trim();
  if (!text) return alert('Write a reply first.');
  try {
    await addDoc(collection(db, 'listings', activeThread.id, 'replies'), {
      uid:currentUser.uid,
      authorEmail:currentUser.email || '',
      authorName:currentProfile.displayName || currentUser.email || '',
      displayName:currentProfile.displayName || currentUser.email || '',
      userEmail:currentUser.email || '',
      text,
      createdAt:serverTimestamp(),
      createdAtMs:Date.now()
    });
    if ($('replyText')) $('replyText').value = '';
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Unable to send reply.');
  }
}

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
        applyVisibilityUI();
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
      await ensureProfile(user);
      if (currentProfile?.banned) {
        await signOut(auth);
        alert('Your marketplace access has been disabled.');
        return;
      }
      if ($('verifyNote')) $('verifyNote').style.display = 'none';
      if ($('btnResendVerify')) $('btnResendVerify').style.display = 'none';
      applyVisibilityUI();
      startListingsListener();
      if (!currentProfile?.displayName) {
        if ($('displayNameInput')) $('displayNameInput').value = user.displayName || '';
        show('nameOverlay');
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Authentication error.');
    }
  });
});
