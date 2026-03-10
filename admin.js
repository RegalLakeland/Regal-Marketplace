import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const AUTH_FUNCTION_REGION = 'us-central1';
function verificationFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/resendVerificationEmail`;
}
async function callAdminVerificationResend(email) {
  if (!currentViewer) throw new Error('You must be signed in.');
  const token = await currentViewer.getIdToken(true);
  const res = await fetch(verificationFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Resend failed (${res.status})`);
  return data;
}
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const boardLabels = { FREE:'Free Items', BUYSELL:'Buy / Sell', GARAGE:'Garage Sales', EVENTS:'Events', WORK:'Work News', SERVICES:'Local Services' };

function fmtDate(ms){ try{ return new Date(Number(ms||Date.now())).toLocaleString(); } catch { return '—'; } }
function normalizeEmail(email){ return String(email||'').trim().toLowerCase(); }
function isAdmin(email){ return ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(normalizeEmail(email)); }
const PROTECTED_CORE_ADMINS = new Set([
  'michael.h@regallakeland.com',
  'janni.r@regallakeland.com'
]);
function isProtectedCoreAdmin(email){ return PROTECTED_CORE_ADMINS.has(normalizeEmail(email)); }
function isCoreAdminViewer(){ return isProtectedCoreAdmin(currentViewer?.email); }

let authResolved = false;
let currentViewer = null;
let currentViewerProfile = null;
let listingRowsData = [];
let userRowsData = [];
let adminEditingId = null;
let userSearchTerm = '';
let userFilterValue = 'ALL';
onAuthStateChanged(auth, async (user) => {
  authResolved = true;
  currentViewer = user || null;
  if (!user) {
    alert('Please log in first.');
    location.href = 'index.html';
    return;
  }

  const profileSnap = await getDoc(doc(db, 'profiles', user.uid)).catch(() => null);
  currentViewerProfile = profileSnap?.exists() ? { id: profileSnap.id, ...profileSnap.data() } : null;
  const allowed = !!(isProtectedCoreAdmin(user.email) || currentViewerProfile?.isAdmin || isAdmin(user.email));
  if (!allowed) {
    alert('Admin access only.');
    location.href = 'index.html';
    return;
  }
  if ($('adminUser')) $('adminUser').textContent = user.email;
  $('userSearch')?.addEventListener('input', (e) => { userSearchTerm = String(e.target.value || '').trim().toLowerCase(); renderUserRows(); });
  $('userFilter')?.addEventListener('change', (e) => { userFilterValue = String(e.target.value || 'ALL'); renderUserRows(); });
  startListings();
  startUsers();
});

function startListings(){
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    listingRowsData = rows;
    if ($('adminListingCount')) $('adminListingCount').textContent = String(rows.length);
    if ($('adminRequestCount')) $('adminRequestCount').textContent = String(rows.filter(r => r.reactivationRequested).length);
    if (!$('listingRows')) return;
    $('listingRows').innerHTML = rows.map(item => {
      const board = item.board || item.category || 'BUYSELL';
      const poster = item.authorName || item.displayName || item.authorEmail || item.userEmail || '—';
      const requestPill = item.reactivationRequested ? `<div class="note">Reactivation requested ${esc(fmtDate(item.reactivationRequestedAt))}</div>` : '';
      const hiddenPill = item.hidden ? `<div class="note">Hidden from marketplace view</div>` : '';
      const featuredPill = item.featured ? `<div class="note">Featured on homepage</div>` : '';
      return `
        <tr>
          <td><strong>${esc(item.title || 'Untitled')}</strong><div class="note">${esc(fmtDate(item.createdAtMs))}</div>${requestPill}${hiddenPill}${featuredPill}</td>
          <td>${esc(boardLabels[board] || board)}</td>
          <td>${esc(item.status || 'ACTIVE')}</td>
          <td>${esc(poster)}</td>
          <td>
            <div class="rowBtns">
              ${item.status !== 'SOLD' ? `<button class="btn" data-sold="${esc(item.id)}" type="button">Mark Sold</button>` : ''}
              ${item.status === 'SOLD' ? `<button class="btn primary" data-approve="${esc(item.id)}" type="button">Mark Active</button>` : ''}
              ${item.status === 'SOLD' && item.reactivationRequested ? `<button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny Request</button>` : ''}
              <button class="btn ghost" data-feature="${esc(item.id)}" data-on="${item.featured ? '1' : '0'}" type="button">${item.featured ? 'Unfeature' : 'Feature'}</button>
              <button class="btn ghost" data-edit="${esc(item.id)}" type="button">Edit</button>
              <button class="btn ghost" data-hide="${esc(item.id)}" data-on="${item.hidden ? '1' : '0'}" type="button">${item.hidden ? 'Unhide' : 'Hide'}</button>
              <button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    document.querySelectorAll('[data-sold]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.sold), { status:'SOLD', reactivationRequested:false });
    });
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.approve), {
        status:'ACTIVE',
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt:null
      });
    });
    document.querySelectorAll('[data-deny]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.deny), {
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt: Date.now()
      });
    });
    document.querySelectorAll('[data-feature]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.feature), { featured: btn.dataset.on !== '1' });
    });
    document.querySelectorAll('[data-hide]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.hide), { hidden: btn.dataset.on !== '1' });
    });
    document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
    document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Delete this post permanently?')) return;
      await deleteDoc(doc(db, 'listings', btn.dataset.delete));
    });
  });
}


function duplicateMeta(rows) {
  const groups = new Map();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(row);
  }
  const meta = new Map();
  for (const [email, items] of groups.entries()) {
    items.sort((a, b) => {
      const av = Number(a.createdAtMs || a.emailVerifiedAt || 0);
      const bv = Number(b.createdAtMs || b.emailVerifiedAt || 0);
      return av - bv;
    });
    const primaryId = items[0]?.id;
    for (const item of items) {
      meta.set(item.id, {
        count: items.length,
        isDuplicate: items.length > 1,
        isPrimary: item.id === primaryId
      });
    }
  }
  return meta;
}

function userPending(user) {
  return !user.accessApproved || (!user.emailVerified && !user.manualVerified);
}

function applyUserFilters(rows) {
  const dmeta = duplicateMeta(rows);
  let filtered = rows.slice();
  if (userSearchTerm) {
    filtered = filtered.filter((user) => {
      const hay = [user.email, user.displayName].join(' ').toLowerCase();
      return hay.includes(userSearchTerm);
    });
  }
  if (userFilterValue === 'PENDING') filtered = filtered.filter(userPending);
  if (userFilterValue === 'ADMIN') filtered = filtered.filter((u) => !!u.isAdmin || isProtectedCoreAdmin(u.email));
  if (userFilterValue === 'MODERATOR') filtered = filtered.filter((u) => !!u.isModerator);
  if (userFilterValue === 'BANNED') filtered = filtered.filter((u) => !!u.banned);
  if (userFilterValue === 'DUPLICATES') filtered = filtered.filter((u) => dmeta.get(u.id)?.isDuplicate);
  filtered.sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email)) || normalizeEmail(a.displayName).localeCompare(normalizeEmail(b.displayName)));
  return { filtered, dmeta };
}

function renderUserRows() {
  if (!$('userRows')) return;
  const { filtered, dmeta } = applyUserFilters(userRowsData);
  if ($('adminUserCount')) $('adminUserCount').textContent = String(userRowsData.length);
  if ($('adminPendingCount')) $('adminPendingCount').textContent = `${userRowsData.filter(userPending).length} pending`;

  $('userRows').innerHTML = filtered.map(user => {
    const protectedUser = isProtectedCoreAdmin(user.email);
    const dup = dmeta.get(user.id) || { isDuplicate:false, isPrimary:true, count:1 };
    const roleBits = [];
    if (protectedUser || user.isAdmin) roleBits.push('<span class="role-pill role-admin">Admin</span>');
    if (user.isModerator) roleBits.push('<span class="role-pill role-mod">Moderator</span>');
    if (user.accessApproved) roleBits.push('<span class="role-pill role-ok">Access Approved</span>');
    else roleBits.push('<span class="role-pill role-pending">Pending Access</span>');
    if (user.emailVerified || user.manualVerified) roleBits.push(`<span class="role-pill role-ok">${user.manualVerified && !user.emailVerified ? 'Manual Email Approved' : 'Email Verified'}</span>`);
    else roleBits.push('<span class="role-pill role-pending">Email Pending</span>');
    if (user.banned) roleBits.push('<span class="role-pill role-ban">Blocked</span>');
    if (protectedUser) roleBits.push('<span class="role-pill">Protected</span>');
    if (dup.isDuplicate) roleBits.push(`<span class="role-pill role-warn">Duplicate x${dup.count}</span>`);

    return `
      <tr>
        <td>
          <div class="user-main">${esc(user.email || '—')}</div>
          <div class="note">UID: ${esc(user.uid || user.id)}</div>
        </td>
        <td>
          <div class="user-main">${esc(user.displayName || '—')}</div>
          <div class="note">${esc(fmtDate(user.createdAtMs || user.emailVerifiedAt || Date.now()))}</div>
        </td>
        <td><div class="role-pills">${roleBits.join(' ')}</div></td>
        <td>
          <div class="rowBtns compact-rowBtns">
            ${!user.isModerator ? `<button class="btn ghost" data-role="grantMod" data-id="${esc(user.id)}" type="button">Grant Moderator</button>` : ''}
            ${user.isModerator && !protectedUser ? `<button class="btn ghost" data-role="removeMod" data-id="${esc(user.id)}" type="button">Remove Moderator</button>` : ''}
            ${!user.isAdmin ? `<button class="btn" data-role="grantAdmin" data-id="${esc(user.id)}" type="button">Grant Admin</button>` : ''}
            ${user.isAdmin && !protectedUser ? `<button class="btn ghost" data-role="removeAdmin" data-id="${esc(user.id)}" type="button">Remove Admin</button>` : ''}
            ${!user.accessApproved ? `<button class="btn primary" data-role="approveAccess" data-id="${esc(user.id)}" type="button">Approve Access</button>` : ''}
            ${user.accessApproved && !protectedUser ? `<button class="btn ghost" data-role="denyAccess" data-id="${esc(user.id)}" type="button">Deny Access</button>` : ''}
            ${isCoreAdminViewer() && !user.emailVerified ? `<button class="btn ghost" data-role="resendVerify" data-id="${esc(user.id)}" type="button">Resend Verify Email</button>` : ''}${isCoreAdminViewer() && !user.manualVerified && !user.emailVerified ? `<button class="btn ghost" data-role="approveEmail" data-id="${esc(user.id)}" type="button">Approve Email</button>` : ''}
            ${isCoreAdminViewer() && user.manualVerified && !protectedUser ? `<button class="btn ghost" data-role="revokeEmail" data-id="${esc(user.id)}" type="button">Revoke Email</button>` : ''}
            ${!user.banned && !protectedUser ? `<button class="btn danger" data-role="banUser" data-id="${esc(user.id)}" type="button">Block</button>` : ''}
            ${user.banned && !protectedUser ? `<button class="btn ghost" data-role="unbanUser" data-id="${esc(user.id)}" type="button">Restore</button>` : ''}
            ${dup.isDuplicate && !dup.isPrimary && !protectedUser ? `<button class="btn danger" data-role="deleteDuplicate" data-id="${esc(user.id)}" type="button">Delete Duplicate</button>` : ''}
            ${protectedUser ? `<span class="pill">Locked</span>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('[data-role]').forEach(btn => btn.onclick = async () => {
    const user = userRowsData.find((x) => x.id === btn.dataset.id);
    if (!user) return;
    const role = btn.dataset.role;
    if (isProtectedCoreAdmin(user.email) && ['removeMod','removeAdmin','banUser','revokeEmail','denyAccess','deleteDuplicate'].includes(role)) {
      alert('This core admin account cannot be modified.');
      return;
    }
    const ref = doc(db, 'profiles', user.id);
    if (role === 'grantMod') await updateDoc(ref, { isModerator: true, updatedAt: Date.now() });
    if (role === 'removeMod') await updateDoc(ref, { isModerator: false, updatedAt: Date.now() });
    if (role === 'grantAdmin') await updateDoc(ref, { isAdmin: true, accessApproved: true, updatedAt: Date.now() });
    if (role === 'removeAdmin') await updateDoc(ref, { isAdmin: false, updatedAt: Date.now() });
    if (role === 'approveAccess') await updateDoc(ref, { accessApproved: true, updatedAt: Date.now() });
    if (role === 'denyAccess') await updateDoc(ref, { accessApproved: false, updatedAt: Date.now() });
    if (role === 'resendVerify') {
      try {
        await callAdminVerificationResend(user.email);
        await updateDoc(ref, { verificationEmailSentAt: Date.now(), verificationEmailSentBy: normalizeEmail(currentViewer?.email), updatedAt: Date.now() });
        alert(`Verification email sent to ${user.email}.`);
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Unable to send verification email.');
      }
    }
    if (role === 'approveEmail') await updateDoc(ref, { manualVerified: true, updatedAt: Date.now() });
    if (role === 'revokeEmail') await updateDoc(ref, { manualVerified: false, updatedAt: Date.now() });
    if (role === 'banUser') await updateDoc(ref, { banned: true, updatedAt: Date.now() });
    if (role === 'unbanUser') await updateDoc(ref, { banned: false, updatedAt: Date.now() });
    if (role === 'deleteDuplicate') {
      if (!confirm(`Delete duplicate profile for ${user.email}? This only removes the extra profile row.`)) return;
      await deleteDoc(ref);
    }
  });
}

function startUsers(){
  onSnapshot(collection(db, 'profiles'), (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    userRowsData = rows;
    renderUserRows();
  });
}



function ensureEditModal(){
  if (document.getElementById('adminEditOverlay')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="overlay" id="adminEditOverlay" style="display:none">
    <div class="modal wide modal-scroll">
      <div class="modal-h sticky-head">
        <strong>Edit Post</strong>
        <button class="btn ghost" id="adminEditClose" type="button">Close</button>
      </div>
      <div class="modal-b">
        <div class="grid2">
          <div class="field"><label>Board</label><select id="adminEditBoard"><option value="FREE">Free Items</option><option value="BUYSELL">Buy / Sell</option><option value="GARAGE">Garage Sales</option><option value="EVENTS">Events</option><option value="WORK">Work News</option><option value="SERVICES">Local Services</option></select></div>
          <div class="field"><label>Status</label><select id="adminEditStatus"><option value="ACTIVE">Active</option><option value="SOLD">Sold</option></select></div>
        </div>
        <div class="field"><label>Title</label><input id="adminEditTitle" /></div>
        <div class="grid2"><div class="field"><label>Price</label><input id="adminEditPrice" inputmode="decimal" /></div><div class="field"><label>Location</label><input id="adminEditLocation" /></div></div>
        <div class="field"><label>Description</label><textarea id="adminEditDesc"></textarea></div>
        <div class="field"><label>Contact</label><input id="adminEditContact" /></div>
        <div class="grid2"><div class="field"><label><input id="adminEditFeatured" type="checkbox" /> Featured</label></div><div class="field"><label><input id="adminEditHidden" type="checkbox" /> Hidden</label></div></div>
      </div>
      <div class="modal-actions sticky-actions"><button class="btn primary" id="adminEditSave" type="button">Save Changes</button></div>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
  document.getElementById('adminEditClose')?.addEventListener('click', closeEditModal);
  document.getElementById('adminEditOverlay')?.addEventListener('click', (e) => { if (e.target.id === 'adminEditOverlay') closeEditModal(); });
  document.getElementById('adminEditSave')?.addEventListener('click', saveAdminEdit);
}

function openEditModal(id){
  ensureEditModal();
  const item = listingRowsData.find((x) => x.id === id);
  if (!item) return;
  adminEditingId = id;
  document.getElementById('adminEditBoard').value = item.board || item.category || 'BUYSELL';
  document.getElementById('adminEditStatus').value = String(item.status || 'ACTIVE').toUpperCase();
  document.getElementById('adminEditTitle').value = item.title || '';
  document.getElementById('adminEditPrice').value = item.price ?? '';
  document.getElementById('adminEditLocation').value = item.location || '';
  document.getElementById('adminEditDesc').value = item.description || item.desc || '';
  document.getElementById('adminEditContact').value = item.contact || '';
  document.getElementById('adminEditFeatured').checked = !!item.featured;
  document.getElementById('adminEditHidden').checked = !!item.hidden;
  document.getElementById('adminEditOverlay').style.display = 'flex';
}

function closeEditModal(){
  adminEditingId = null;
  const overlay = document.getElementById('adminEditOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function saveAdminEdit(){
  if (!adminEditingId) return;
  const board = document.getElementById('adminEditBoard').value || 'BUYSELL';
  const status = document.getElementById('adminEditStatus').value || 'ACTIVE';
  const title = document.getElementById('adminEditTitle').value.trim();
  const price = document.getElementById('adminEditPrice').value.trim();
  const location = document.getElementById('adminEditLocation').value.trim();
  const description = document.getElementById('adminEditDesc').value.trim();
  const contact = document.getElementById('adminEditContact').value.trim();
  const featured = document.getElementById('adminEditFeatured').checked;
  const hidden = document.getElementById('adminEditHidden').checked;
  if (!title || !description) { alert('Title and description are required.'); return; }
  await updateDoc(doc(db, 'listings', adminEditingId), {
    board, category: board, status, title, price: Number(price || 0), location, description, desc: description, contact, featured, hidden
  });
  closeEditModal();
}
