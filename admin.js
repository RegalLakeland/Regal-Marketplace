import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const boardLabels = { ALL:'All Boards', FREE:'Free Items', BUYSELL:'Buy / Sell', GARAGE:'Garage Sales', EVENTS:'Events', WORK:'Work News', SERVICES:'Local Services' };

function fmtDate(ms){ try{ return new Date(Number(ms||Date.now())).toLocaleString(); } catch { return '—'; } }
function isAdmin(email){ return ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(String(email||'').toLowerCase()); }

onAuthStateChanged(auth, (user) => {
  if (!user || !isAdmin(user.email)) {
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
    if (!$('listingRows')) return;
    $('listingRows').innerHTML = rows.map(item => {
      const board = item.board || item.category || 'BUYSELL';
      const poster = item.authorName || item.displayName || item.authorEmail || item.userEmail || '—';
      const requestPill = item.reactivationRequested ? `<div class="meta">Reactivation requested</div>` : '';
      return `
        <tr>
          <td><strong>${esc(item.title || 'Untitled')}</strong><div class="meta">${esc(fmtDate(item.createdAtMs))}</div>${requestPill}</td>
          <td>${esc(boardLabels[board] || board)}</td>
          <td>${esc(item.status || 'ACTIVE')}</td>
          <td>${esc(poster)}</td>
          <td>
            <div class="rowBtns">
              ${item.status !== 'SOLD' ? `<button class="btn" data-sold="${esc(item.id)}" type="button">Mark Sold</button>` : ``}
              ${item.status === 'SOLD' && item.reactivationRequested ? `<button class="btn primary" data-approve="${esc(item.id)}" type="button">Approve Active</button><button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny</button>` : ``}
              ${item.status === 'SOLD' && !item.reactivationRequested ? `<button class="btn" data-active="${esc(item.id)}" type="button">Mark Active</button>` : ``}
              <button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    document.querySelectorAll('[data-sold]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.sold), { status:'SOLD' });
    });
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.approve), {
        status:'ACTIVE',
        reactivationRequested:false,
        reactivationRequestedAt:null
      });
    });
    document.querySelectorAll('[data-deny]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.deny), {
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt: Date.now()
      });
    });
    document.querySelectorAll('[data-active]').forEach(btn => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.active), { status:'ACTIVE', reactivationRequested:false, reactivationRequestedAt:null });
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
