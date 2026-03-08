import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const boardLabels = { FREE:'Free Items', BUYSELL:'Buy / Sell', GARAGE:'Garage Sales', EVENTS:'Events', WORK:'Work News', SERVICES:'Local Services' };

function fmtDate(ms){ try{ return new Date(Number(ms||Date.now())).toLocaleString(); } catch { return '—'; } }
function isAdmin(email){ return ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(String(email||'').toLowerCase()); }

const EDIT_MODAL_HTML = `
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

let adminListingsCache = [];
let adminEditingId = null;

function ensureEditModal(){
  if (document.getElementById('adminEditOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', EDIT_MODAL_HTML);
  document.getElementById('adminEditClose')?.addEventListener('click', closeEditModal);
  document.getElementById('adminEditOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminEditOverlay') closeEditModal();
  });
  document.getElementById('adminEditSave')?.addEventListener('click', saveAdminEdit);
}

function openEditModal(id){
  ensureEditModal();
  const item = adminListingsCache.find((x) => x.id === id);
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
  document.body.classList.add('modal-open');
}

function closeEditModal(){
  adminEditingId = null;
  const overlay = document.getElementById('adminEditOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('modal-open');
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
  if (!title) { alert('Enter a title.'); return; }
  if (!description) { alert('Enter a description.'); return; }
  await updateDoc(doc(db, 'listings', adminEditingId), {
    board, category: board, status, title, price: Number(price || 0), location,
    description, desc: description, contact, featured, hidden, updatedAt: Date.now()
  });
  closeEditModal();
}


let authResolved = false;
onAuthStateChanged(auth, (user) => {
  authResolved = true;
  if (!user) {
    alert('Please log in first.');
    location.href = 'index.html';
    return;
  }
  if (!isAdmin(user.email)) {
    alert('Admin access only.');
    location.href = 'index.html';
    return;
  }
  if ($('adminUser')) $('adminUser').textContent = user.email;
  startListings();
  startUsers();
});

function startListings(){
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    adminListingsCache = rows;
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
              <button class="btn ghost" data-edit="${esc(item.id)}" type="button">Edit</button>
              ${item.status !== 'SOLD' ? `<button class="btn" data-sold="${esc(item.id)}" type="button">Mark Sold</button>` : ''}
              ${item.status === 'SOLD' ? `<button class="btn primary" data-approve="${esc(item.id)}" type="button">Mark Active</button>` : ''}
              ${item.status === 'SOLD' && item.reactivationRequested ? `<button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny Request</button>` : ''}
              <button class="btn ghost" data-feature="${esc(item.id)}" data-on="${item.featured ? '1' : '0'}" type="button">${item.featured ? 'Unfeature' : 'Feature'}</button>
              <button class="btn ghost" data-hide="${esc(item.id)}" data-on="${item.hidden ? '1' : '0'}" type="button">${item.hidden ? 'Unhide' : 'Hide'}</button>
              <button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
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
    document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Delete this post permanently?')) return;
      await deleteDoc(doc(db, 'listings', btn.dataset.delete));
    });
  });
}

function startUsers(){
  onSnapshot(collection(db, 'profiles'), (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
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
