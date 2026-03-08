import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((e)=>console.warn("Auth persistence warning:", e));
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const boardLabels = { ALL:'All Boards', FREE:'Free Items', BUYSELL:'Buy / Sell', GARAGE:'Garage Sales', EVENTS:'Events', WORK:'Work News', SERVICES:'Local Services' };
let listingCache = [];
let userCache = [];
let adminReady = false;

function fmtDate(ms){ try{ return new Date(Number(ms||Date.now())).toLocaleString(); } catch { return '—'; } }
function isAdmin(email){ return ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(String(email||'').trim().toLowerCase()); }

ensureEditOverlay();
bindAdminEditEvents();

onAuthStateChanged(auth, (user) => {
  const allowed = !!(user && isAdmin(user.email));
  if ($('adminUser')) $('adminUser').textContent = user ? user.email : 'Not signed in';
  adminReady = allowed;
  if (!allowed) return;
  startListings();
  startUsers();
});

function startListings(){
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    listingCache = rows;
    if ($('adminListingCount')) $('adminListingCount').textContent = String(rows.length);
    if ($('adminRequestCount')) $('adminRequestCount').textContent = String(rows.filter(r => r.reactivationRequested).length);
    if (!$('listingRows')) return;
    $('listingRows').innerHTML = rows.map(item => {
      const board = item.board || item.category || 'BUYSELL';
      const poster = item.authorName || item.displayName || item.authorEmail || item.userEmail || '—';
      const requestPill = item.reactivationRequested ? `<div class="note">Reactivation requested ${esc(fmtDate(item.reactivationRequestedAt))}</div>` : '';
      return `
        <tr>
          <td><strong>${esc(item.title || 'Untitled')}</strong><div class="note">${esc(fmtDate(item.createdAtMs))}</div>${requestPill}</td>
          <td>${esc(boardLabels[board] || board)}</td>
          <td>${esc(item.status || 'ACTIVE')}</td>
          <td>${esc(poster)}</td>
          <td>
            <div class="rowBtns">
              <button class="btn ghost" data-edit="${esc(item.id)}" type="button">Edit</button>
              ${item.status !== 'SOLD' ? `<button class="btn" data-sold="${esc(item.id)}" type="button">Mark Sold</button>` : `<button class="btn primary" data-active="${esc(item.id)}" type="button">Mark Active</button>`}
              ${item.status === 'SOLD' && item.reactivationRequested ? `<button class="btn primary" data-approve="${esc(item.id)}" type="button">Approve Active</button><button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny</button>` : ``}
              <button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openAdminEdit(btn.dataset.edit));
    document.querySelectorAll('[data-sold]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.sold), { status:'SOLD', updatedAt: Date.now(), reactivationRequested:false, reactivationRequestedAt:null });
    });
    document.querySelectorAll('[data-active]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.active), { status:'ACTIVE', reactivationRequested:false, reactivationRequestedAt:null, updatedAt: Date.now() });
    });
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.approve), {
        status:'ACTIVE',
        reactivationRequested:false,
        reactivationRequestedAt:null,
        updatedAt: Date.now()
      });
    });
    document.querySelectorAll('[data-deny]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.deny), {
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt: Date.now()
      });
    });
    document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Delete this post permanently?')) return;
      await deleteDoc(doc(db, 'listings', btn.dataset.delete));
    });
  });
}

function startUsers(){
  onSnapshot(collection(db, 'profiles'), (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    userCache = rows;
    if ($('adminUserCount')) $('adminUserCount').textContent = String(rows.length);
    if (!$('userRows')) return;
    $('userRows').innerHTML = rows.map(user => `
      <tr>
        <td>${esc(user.email || '—')}</td>
        <td>${esc(user.displayName || '—')}</td>
        <td>${user.banned ? 'Blocked' : 'Active'}</td>
        <td><button class="btn ${user.banned ? 'ghost' : 'danger'}" data-ban="${esc(user.id)}" data-state="${user.banned ? '0' : '1'}" type="button">${user.banned ? 'Restore Access' : 'Block Access'}</button></td>
      </tr>
    `).join('');
    document.querySelectorAll('[data-ban]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'profiles', btn.dataset.ban), { banned: btn.dataset.state === '1' });
    });
  });
}

function ensureEditOverlay(){
  if ($('adminEditOverlay')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="overlay" id="adminEditOverlay" style="display:none;">
    <div class="modal wide modal-scroll">
      <div class="modal-h sticky-head">
        <strong>Edit Post</strong>
        <button class="btn ghost" id="adminEditClose" type="button">Close</button>
      </div>
      <div class="modal-b">
        <input id="adminEditId" type="hidden" />
        <div class="grid2">
          <div class="field">
            <label>Board</label>
            <select id="adminEditBoard">
              <option value="FREE">Free Items</option>
              <option value="BUYSELL">Buy / Sell</option>
              <option value="GARAGE">Garage Sales</option>
              <option value="EVENTS">Events</option>
              <option value="WORK">Work News</option>
              <option value="SERVICES">Local Services</option>
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="adminEditStatus">
              <option value="ACTIVE">Active</option>
              <option value="SOLD">Sold</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Title</label>
          <input id="adminEditTitle" />
        </div>
        <div class="grid2">
          <div class="field">
            <label>Price</label>
            <input id="adminEditPrice" inputmode="decimal" />
          </div>
          <div class="field">
            <label>Location</label>
            <input id="adminEditLocation" />
          </div>
        </div>
        <div class="field">
          <label>Description</label>
          <textarea id="adminEditDesc"></textarea>
        </div>
        <div class="field">
          <label>Contact</label>
          <input id="adminEditContact" />
        </div>
      </div>
      <div class="modal-actions sticky-actions">
        <button class="btn ghost" id="adminEditCancel" type="button">Cancel</button>
        <button class="btn primary" id="adminEditSave" type="button">Save Changes</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function bindAdminEditEvents(){
  document.body.addEventListener('click', (e) => {
    if (e.target?.id === 'adminEditClose' || e.target?.id === 'adminEditCancel') closeAdminEdit();
    if (e.target?.id === 'adminEditSave') saveAdminEdit();
  });
}

function openAdminEdit(id){
  if (!adminReady) return;
  const item = listingCache.find((x) => x.id === id);
  if (!item) return;
  if ($('adminEditId')) $('adminEditId').value = id;
  if ($('adminEditBoard')) $('adminEditBoard').value = item.board || item.category || 'BUYSELL';
  if ($('adminEditStatus')) $('adminEditStatus').value = item.status || 'ACTIVE';
  if ($('adminEditTitle')) $('adminEditTitle').value = item.title || '';
  if ($('adminEditPrice')) $('adminEditPrice').value = item.price ?? '';
  if ($('adminEditLocation')) $('adminEditLocation').value = item.location || '';
  if ($('adminEditDesc')) $('adminEditDesc').value = item.description || item.desc || '';
  if ($('adminEditContact')) $('adminEditContact').value = item.contact || '';
  if ($('adminEditOverlay')) $('adminEditOverlay').style.display = 'flex';
}

function closeAdminEdit(){
  if ($('adminEditOverlay')) $('adminEditOverlay').style.display = 'none';
}

async function saveAdminEdit(){
  const id = $('adminEditId')?.value;
  if (!id) return;
  const title = $('adminEditTitle')?.value.trim();
  const description = $('adminEditDesc')?.value.trim();
  if (!title || !description) {
    alert('Title and description are required.');
    return;
  }
  const board = $('adminEditBoard')?.value || 'BUYSELL';
  const status = $('adminEditStatus')?.value || 'ACTIVE';
  const priceValue = $('adminEditPrice')?.value.trim() || '';
  await updateDoc(doc(db, 'listings', id), {
    board,
    category: board,
    status,
    title,
    description,
    desc: description,
    location: $('adminEditLocation')?.value.trim() || '',
    contact: $('adminEditContact')?.value.trim() || '',
    price: Number(priceValue || 0),
    updatedAt: Date.now(),
    reactivationRequested: false,
    reactivationRequestedAt: null
  });
  closeAdminEdit();
}
