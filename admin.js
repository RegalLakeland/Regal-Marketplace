
import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const AUTH_FUNCTION_REGION = 'us-central1';
const CORE_ADMIN_EMAILS = [
  'michael.h@regallakeland.com',
  'janni.r@regallakeland.com'
];

let currentViewer = null;
let currentViewerProfile = null;
let listingRowsData = [];
let userRowsData = [];
let eventRowsData = [];
let adminEditingId = null;
let userSearchTerm = '';
let userFilterValue = 'ALL';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const boardLabels = {
  FREE:'Free Items',
  BUYSELL:'Buy / Sell',
  GARAGE:'Garage Sales',
  EVENTS:'Events',
  WORK:'Work News',
  SERVICES:'Local Services'
};

function injectOwnerViewStyles() {
  if (document.getElementById('ownerViewStyles')) return;
  const style = document.createElement('style');
  style.id = 'ownerViewStyles';
  style.textContent = `
    .owner-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:14px 0 18px}
    .owner-card{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
    .owner-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.72;margin-bottom:8px}
    .owner-value{font-size:30px;font-weight:800;line-height:1}
    .owner-sub{font-size:12px;opacity:.72;margin-top:8px}
    .owner-section{margin:18px 0 22px;padding:16px;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    .owner-section h3{margin:0 0 14px 0;font-size:18px}
    .owner-split{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}
    .owner-list{display:grid;gap:10px}
    .owner-list-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04)}
    .owner-list-main{font-weight:700}
    .owner-list-sub{font-size:12px;opacity:.72;margin-top:3px}
    .owner-pill{display:inline-flex;align-items:center;justify-content:center;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(255,255,255,.08)}
    .owner-pill.ok{background:rgba(60,179,113,.18);color:#a8f0c1}
    .owner-pill.pending{background:rgba(255,193,7,.16);color:#ffe08a}
    .owner-pill.bad{background:rgba(220,53,69,.18);color:#ffb3bd}
    .owner-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:12px 0 14px}
    .owner-toolbar .owner-left,.owner-toolbar .owner-right{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
    .owner-toolbar input,.owner-toolbar select{min-height:40px;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.16);color:inherit}
    .owner-table-wrap{overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.08)}
    .owner-table-wrap table{width:100%;border-collapse:collapse}
    .owner-table-wrap th,.owner-table-wrap td{padding:12px 14px;vertical-align:top;border-bottom:1px solid rgba(255,255,255,.08)}
    .owner-table-wrap th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.74;background:rgba(255,255,255,.04);position:sticky;top:0;z-index:1}
    .user-main{font-weight:700}
    .user-id,.note{font-size:12px;opacity:.72}
    .user-status-stack{display:grid;gap:8px}
    .user-status-line{display:flex;gap:10px;align-items:flex-start}
    .user-status-key{min-width:70px;font-size:12px;opacity:.7;text-transform:uppercase;letter-spacing:.04em}
    .user-status-value,.user-status-meta{font-size:13px}
    .user-status-value.ok{color:#8fe2aa}
    .user-status-value.pending{color:#ffd36a}
    .user-status-value.bad{color:#ff9daa}
    .rowBtns.compact-rowBtns{display:flex;flex-wrap:wrap;gap:8px}
    .rowBtns.compact-rowBtns .btn{min-height:34px;padding:7px 11px;border-radius:10px}
    .btn.danger{background:#7b1f2a;color:#fff;border:1px solid rgba(255,255,255,.08)}
    .btn.primary{background:#1f6feb;color:#fff;border:1px solid rgba(255,255,255,.08)}
    .btn.ghost{background:rgba(255,255,255,.04);color:inherit;border:1px solid rgba(255,255,255,.1)}
    .owner-empty{padding:22px;text-align:center;opacity:.75}
    .owner-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .owner-mini-card{padding:12px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
    .owner-mini-card .big{font-size:24px;font-weight:800;line-height:1}
    .owner-mini-card .small{font-size:12px;opacity:.72;margin-top:6px}
    .sticky-head{position:sticky;top:0;background:inherit;z-index:2}
    .sticky-actions{position:sticky;bottom:0;background:inherit;z-index:2}
    .modal-scroll{max-height:min(88vh,900px);overflow:auto}
    @media (max-width: 980px){.owner-split{grid-template-columns:1fr}.owner-mini-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function ensureOwnerShell() {
  injectOwnerViewStyles();
  const root = document.body;
  if (!root) return;

  const userCountNode = $('adminUserCount');
  if (userCountNode && document.getElementById('ownerDashboardWrap')) return;

  const container = document.createElement('div');
  container.id = 'ownerDashboardWrap';
  container.className = 'owner-section';
  container.innerHTML = `
    <h3>Owner Overview</h3>
    <div class="owner-card-grid">
      <div class="owner-card"><div class="owner-kicker">Users</div><div class="owner-value" id="ownerUsersValue">0</div><div class="owner-sub" id="ownerUsersSub">Marketplace accounts</div></div>
      <div class="owner-card"><div class="owner-kicker">Pending Approval</div><div class="owner-value" id="ownerPendingValue">0</div><div class="owner-sub" id="ownerPendingSub">Waiting on admin review</div></div>
      <div class="owner-card"><div class="owner-kicker">Active Listings</div><div class="owner-value" id="ownerListingsValue">0</div><div class="owner-sub" id="ownerListingsSub">Live marketplace posts</div></div>
      <div class="owner-card"><div class="owner-kicker">50th Anniversary RSVP</div><div class="owner-value" id="ownerRsvpValue">0</div><div class="owner-sub" id="ownerRsvpSub">Total employee responses</div></div>
    </div>

    <div class="owner-split">
      <div class="owner-section" style="margin:0">
        <h3>50th Anniversary RSVP Analytics</h3>
        <div class="owner-mini-grid">
          <div class="owner-mini-card"><div class="big" id="rsvpAttendBig">0</div><div class="small">Attending</div></div>
          <div class="owner-mini-card"><div class="big" id="rsvpMaybeBig">0</div><div class="small">Maybe</div></div>
          <div class="owner-mini-card"><div class="big" id="rsvpCantBig">0</div><div class="small">Can't Attend</div></div>
        </div>
        <div class="owner-list" id="rsvpHighlights" style="margin-top:12px"></div>
      </div>

      <div class="owner-section" style="margin:0">
        <h3>Admin Highlights</h3>
        <div class="owner-list" id="adminHighlights"></div>
      </div>
    </div>
  `;

  const usersAnchor = $('userRows')?.closest('section, .card, .panel, .owner-section, .tableWrap, .admin-section') || $('userRows')?.parentElement;
  if (usersAnchor && usersAnchor.parentElement) {
    usersAnchor.parentElement.insertBefore(container, usersAnchor);
  } else {
    root.prepend(container);
  }

  const userRowsTable = $('userRows')?.closest('table');
  if (userRowsTable && userRowsTable.parentElement && !userRowsTable.parentElement.classList.contains('owner-table-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'owner-table-wrap';
    userRowsTable.parentElement.insertBefore(wrap, userRowsTable);
    wrap.appendChild(userRowsTable);
  }

  const listingTable = $('listingRows')?.closest('table');
  if (listingTable && listingTable.parentElement && !listingTable.parentElement.classList.contains('owner-table-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'owner-table-wrap';
    listingTable.parentElement.insertBefore(wrap, listingTable);
    wrap.appendChild(listingTable);
  }

  const rsvpTable = $('rsvpRows')?.closest('table');
  if (rsvpTable && rsvpTable.parentElement && !rsvpTable.parentElement.classList.contains('owner-table-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'owner-table-wrap';
    rsvpTable.parentElement.insertBefore(wrap, rsvpTable);
    wrap.appendChild(rsvpTable);
  }

  if ($('userSearch') && $('userFilter')) {
    const left = document.createElement('div');
    left.className = 'owner-left';
    const right = document.createElement('div');
    right.className = 'owner-right';
    const toolbar = document.createElement('div');
    toolbar.className = 'owner-toolbar';
    toolbar.appendChild(left);
    toolbar.appendChild(right);
    const searchParent = $('userSearch').parentElement;
    const filterParent = $('userFilter').parentElement;
    if (searchParent) left.appendChild(searchParent);
    if (filterParent) left.appendChild(filterParent);
    const countPill = document.createElement('div');
    countPill.className = 'owner-pill';
    countPill.id = 'ownerFilterSummary';
    countPill.textContent = 'Showing all users';
    right.appendChild(countPill);

    const target = $('userRows')?.closest('section, .card, .panel, .owner-section, .tableWrap, .admin-section') || $('userRows')?.parentElement;
    if (target && target.firstChild) target.insertBefore(toolbar, target.firstChild);
  }
}

function fmtDate(ms) {
  try { return new Date(Number(ms || Date.now())).toLocaleString(); } catch { return '—'; }
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function isAdmin(email) { return ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(normalizeEmail(email)); }
function isProtectedCoreAdmin(email) { return CORE_ADMIN_EMAILS.includes(normalizeEmail(email)); }
function isCoreAdminViewer() { return isProtectedCoreAdmin(currentViewer?.email); }
function isSelfRow(user) { return !!currentViewer && user?.id === currentViewer.uid; }

function verificationFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/resendVerificationEmail`;
}
function tempPasswordFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/setMarketplaceTemporaryPassword`;
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
  if (!res.ok) throw new Error(data?.error || `Verification link request failed (${res.status})`);
  return data;
}

async function callSetMarketplaceTempPassword(targetUser, temporaryPassword) {
  if (!currentViewer) throw new Error('You must be signed in.');
  const token = await currentViewer.getIdToken(true);
  const res = await fetch(tempPasswordFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ uid: targetUser.id, email: targetUser.email || '', temporaryPassword })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Temporary password request failed (${res.status})`);
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

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
function generateTempPassword() {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const tail = Math.random().toString(36).slice(-4);
  return `Regal!${digits}${tail}`;
}
function accessStatusMeta(user) {
  if (user?.deletedAtMs) return { label: 'Removed', tone: 'bad' };
  if (user?.banned) return { label: 'Blocked', tone: 'bad' };
  if (user?.accessApproved) return { label: 'Granted', tone: 'ok' };
  if (user?.accessManuallyDenied) return { label: 'Denied', tone: 'bad' };
  return { label: 'Pending', tone: 'pending' };
}
function emailStatusMeta(user) {
  if (user?.emailVerified) return { label: 'Verified Inbox', tone: 'ok' };
  if (user?.manualVerified) return { label: 'Manual Review', tone: 'ok' };
  return { label: 'Not Proven', tone: 'pending' };
}
function roleSummary(user, protectedUser) {
  const roles = [];
  if (protectedUser || user?.isAdmin) roles.push('Admin');
  if (user?.isModerator) roles.push('Moderator');
  if (protectedUser) roles.push('Protected');
  return roles.length ? roles.join(' • ') : 'Standard User';
}
function flagSummary(user, dup) {
  const flags = [];
  if (dup?.isDuplicate) flags.push(`Duplicate x${dup.count}`);
  if (!user?.emailVerified) flags.push('Manual-only email');
  if (!user?.displayName && !user?.pendingName && !user?.requestedName) flags.push('Name missing');
  if (user?.mustChangePassword) flags.push('Temp password active');
  if (user?.deletedAtMs) flags.push('Marketplace removed');
  return flags.length ? flags.join(' • ') : '—';
}

async function disableMarketplaceAccount(targetUser) {
  const uid = targetUser.id;
  const email = normalizeEmail(targetUser.email);
  const viewerEmail = normalizeEmail(currentViewer?.email);

  const selfRow = isSelfRow(targetUser);
  const protectedUser = isProtectedCoreAdmin(email);

  if (!isCoreAdminViewer()) {
    throw new Error('Only Michael and Janni can remove accounts.');
  }
  if (protectedUser && !selfRow) {
    throw new Error('Protected core admin account cannot be removed by another admin.');
  }

  const listingsSnap = await getDocs(query(collection(db, 'listings'), where('uid', '==', uid)));
  for (const d of listingsSnap.docs) await deleteDoc(d.ref);

  const rsvpSnap = await getDocs(query(collection(db, 'eventResponses'), where('uid', '==', uid)));
  for (const d of rsvpSnap.docs) await deleteDoc(d.ref);

  const duplicateProfilesSnap = email
    ? await getDocs(query(collection(db, 'profiles'), where('email', '==', email)))
    : null;

  if (duplicateProfilesSnap) {
    for (const d of duplicateProfilesSnap.docs) {
      if (d.id !== uid) {
        await updateDoc(d.ref, {
          banned: true,
          accessApproved: false,
          accessManuallyDenied: true,
          isAdmin: false,
          isModerator: false,
          manualVerified: false,
          mustChangePassword: false,
          tempPasswordActive: false,
          deletedAtMs: Date.now(),
          deletedBy: viewerEmail,
          updatedAt: Date.now()
        }).catch(() => {});
      }
    }
  }

  await updateDoc(doc(db, 'profiles', uid), {
    banned: true,
    accessApproved: false,
    accessManuallyDenied: true,
    isAdmin: protectedUser ? true : false,
    isModerator: false,
    manualVerified: false,
    mustChangePassword: false,
    tempPasswordActive: false,
    deletedAtMs: Date.now(),
    deletedBy: viewerEmail,
    updatedAt: Date.now()
  });

  return {
    ok: true,
    message: selfRow
      ? 'Your marketplace account was removed and blocked from future access.'
      : 'User removed from the marketplace and blocked from future access.'
  };
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
      const hay = [user.email, user.displayName, user.pendingName, user.requestedName].join(' ').toLowerCase();
      return hay.includes(userSearchTerm);
    });
  }
  if (userFilterValue === 'PENDING') filtered = filtered.filter(userPending);
  if (userFilterValue === 'ADMIN') filtered = filtered.filter((u) => !!u.isAdmin || isProtectedCoreAdmin(u.email));
  if (userFilterValue === 'MODERATOR') filtered = filtered.filter((u) => !!u.isModerator);
  if (userFilterValue === 'BANNED') filtered = filtered.filter((u) => !!u.banned || !!u.deletedAtMs);
  if (userFilterValue === 'DUPLICATES') filtered = filtered.filter((u) => dmeta.get(u.id)?.isDuplicate);
  filtered.sort((a, b) =>
    normalizeEmail(a.email).localeCompare(normalizeEmail(b.email)) ||
    normalizeEmail(a.displayName || a.pendingName || a.requestedName).localeCompare(
      normalizeEmail(b.displayName || b.pendingName || b.requestedName)
    )
  );
  return { filtered, dmeta };
}

function renderOwnerHighlights() {
  const usersTotal = userRowsData.length;
  const pending = userRowsData.filter(userPending).length;
  const listingsLive = listingRowsData.filter((x) => !x.hidden && String(x.status || 'ACTIVE').toUpperCase() !== 'SOLD').length;
  const rsvpTotal = eventRowsData.length;
  const attending = eventRowsData.filter((x) => String(x.status || '').toUpperCase() === 'ATTENDING').length;
  const maybe = eventRowsData.filter((x) => String(x.status || '').toUpperCase() === 'MAYBE').length;
  const cant = eventRowsData.filter((x) => String(x.status || '').toUpperCase() === 'CANT').length;

  if ($('ownerUsersValue')) $('ownerUsersValue').textContent = String(usersTotal);
  if ($('ownerPendingValue')) $('ownerPendingValue').textContent = String(pending);
  if ($('ownerListingsValue')) $('ownerListingsValue').textContent = String(listingsLive);
  if ($('ownerRsvpValue')) $('ownerRsvpValue').textContent = String(rsvpTotal);

  if ($('rsvpAttendBig')) $('rsvpAttendBig').textContent = String(attending);
  if ($('rsvpMaybeBig')) $('rsvpMaybeBig').textContent = String(maybe);
  if ($('rsvpCantBig')) $('rsvpCantBig').textContent = String(cant);

  const pendingUsers = userRowsData
    .filter(userPending)
    .slice(0, 6)
    .map((u) => `
      <div class="owner-list-row">
        <div>
          <div class="owner-list-main">${esc(u.displayName || u.pendingName || u.requestedName || u.email || 'Unnamed user')}</div>
          <div class="owner-list-sub">${esc(u.email || 'No email')}</div>
        </div>
        <span class="owner-pill pending">Pending</span>
      </div>
    `)
    .join('');

  if ($('adminHighlights')) {
    $('adminHighlights').innerHTML = pendingUsers || `
      <div class="owner-list-row">
        <div>
          <div class="owner-list-main">No pending approvals</div>
          <div class="owner-list-sub">Everyone is up to date right now.</div>
        </div>
        <span class="owner-pill ok">Clear</span>
      </div>
    `;
  }

  const highlightRows = eventRowsData
    .slice()
    .sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0))
    .slice(0, 8)
    .map((row) => {
      const key = String(row.status || '').toUpperCase();
      const tone = key === 'ATTENDING' ? 'ok' : key === 'MAYBE' ? 'pending' : 'bad';
      const label = key === 'ATTENDING' ? 'Attending' : key === 'MAYBE' ? 'Maybe' : "Can't Attend";
      return `
        <div class="owner-list-row">
          <div>
            <div class="owner-list-main">${esc(row.displayName || row.userEmail || 'Unknown')}</div>
            <div class="owner-list-sub">${esc(row.userEmail || '—')} • ${esc(fmtDate(row.updatedAtMs || Date.now()))}</div>
          </div>
          <span class="owner-pill ${tone}">${esc(label)}</span>
        </div>
      `;
    })
    .join('');

  if ($('rsvpHighlights')) {
    $('rsvpHighlights').innerHTML = highlightRows || `
      <div class="owner-list-row">
        <div>
          <div class="owner-list-main">No RSVP responses yet</div>
          <div class="owner-list-sub">Responses will appear here automatically.</div>
        </div>
        <span class="owner-pill">Waiting</span>
      </div>
    `;
  }
}

function buildUserActionButtons(user, dup, protectedUser) {
  const buttons = [];
  const selfRow = isSelfRow(user);
  const removed = !!user.deletedAtMs;

  if (!removed) {
    if (!user.isModerator) buttons.push(`<button class="btn ghost" data-role="grantMod" data-id="${esc(user.id)}" type="button">Grant Moderator</button>`);
    if (user.isModerator && !protectedUser) buttons.push(`<button class="btn ghost" data-role="removeMod" data-id="${esc(user.id)}" type="button">Remove Moderator</button>`);

    if (!user.isAdmin) buttons.push(`<button class="btn" data-role="grantAdmin" data-id="${esc(user.id)}" type="button">Grant Admin</button>`);
    if (user.isAdmin && !protectedUser) buttons.push(`<button class="btn ghost" data-role="removeAdmin" data-id="${esc(user.id)}" type="button">Remove Admin</button>`);

    if (!user.accessApproved) buttons.push(`<button class="btn primary" data-role="approveAccess" data-id="${esc(user.id)}" type="button">Approve User</button>`);
    if (user.accessApproved && !protectedUser) buttons.push(`<button class="btn ghost" data-role="denyAccess" data-id="${esc(user.id)}" type="button">Remove Access</button>`);

    if (!protectedUser || selfRow) buttons.push(`<button class="btn ghost" data-role="setTempPassword" data-id="${esc(user.id)}" type="button">Set Temp Password</button>`);
    if (isCoreAdminViewer() && (!protectedUser || selfRow)) buttons.push(`<button class="btn danger" data-role="deleteAccount" data-id="${esc(user.id)}" type="button">Delete Account</button>`);

    if (!user.banned && !protectedUser) buttons.push(`<button class="btn danger" data-role="banUser" data-id="${esc(user.id)}" type="button">Block</button>`);
    if (user.banned && !protectedUser) buttons.push(`<button class="btn ghost" data-role="unbanUser" data-id="${esc(user.id)}" type="button">Restore</button>`);
    if (dup.isDuplicate && !dup.isPrimary && !protectedUser) buttons.push(`<button class="btn danger" data-role="deleteDuplicate" data-id="${esc(user.id)}" type="button">Delete Duplicate</button>`);
  }

  if (!buttons.length && protectedUser && !selfRow) buttons.push('<span class="owner-pill">Protected</span>');
  if (!buttons.length && removed) buttons.push('<span class="owner-pill bad">Removed</span>');
  return buttons.join('');
}

function renderUserRows() {
  if (!$('userRows')) return;
  const { filtered, dmeta } = applyUserFilters(userRowsData);
  if ($('adminUserCount')) $('adminUserCount').textContent = String(userRowsData.length);
  if ($('adminPendingCount')) $('adminPendingCount').textContent = `${userRowsData.filter(userPending).length} pending`;
  if ($('ownerFilterSummary')) {
    $('ownerFilterSummary').textContent = userSearchTerm || userFilterValue !== 'ALL'
      ? `Showing ${filtered.length} filtered users`
      : `Showing ${filtered.length} users`;
  }

  $('userRows').innerHTML = filtered.length ? filtered.map((user) => {
    const protectedUser = isProtectedCoreAdmin(user.email);
    const dup = dmeta.get(user.id) || { isDuplicate:false, isPrimary:true, count:1 };
    const emailState = emailStatusMeta(user);
    const accessState = accessStatusMeta(user);
    const actions = buildUserActionButtons(user, dup, protectedUser);
    const shownName = user.displayName || user.pendingName || user.requestedName || '—';

    return `
      <tr>
        <td>
          <div class="user-main">${esc(user.email || '—')}</div>
          <div class="user-id">UID: ${esc(user.uid || user.id)}</div>
        </td>
        <td>
          <div class="user-main">${esc(shownName)}</div>
          <div class="note">Created / updated: ${esc(fmtDate(user.createdAtMs || user.emailVerifiedAt || Date.now()))}</div>
        </td>
        <td>
          <div class="user-status-stack">
            <div class="user-status-line"><span class="user-status-key">Email</span><span class="user-status-value ${emailState.tone}">${esc(emailState.label)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Access</span><span class="user-status-value ${accessState.tone}">${esc(accessState.label)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Name</span><span class="user-status-meta">${esc(shownName)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Roles</span><span class="user-status-meta">${esc(roleSummary(user, protectedUser))}</span></div>
            <div class="user-status-line"><span class="user-status-key">Password</span><span class="user-status-meta">${esc(user.mustChangePassword ? 'Temporary password active' : 'Normal sign-in')}</span></div>
            <div class="user-status-line"><span class="user-status-key">Flags</span><span class="user-status-meta">${esc(flagSummary(user, dup))}</span></div>
          </div>
        </td>
        <td><div class="rowBtns compact-rowBtns">${actions}</div></td>
      </tr>`;
  }).join('') : '<tr><td colspan="4"><div class="owner-empty">No users match this view.</div></td></tr>';

  document.querySelectorAll('[data-role]').forEach((btn) => btn.onclick = async () => {
    const user = userRowsData.find((x) => x.id === btn.dataset.id);
    if (!user) return;

    const role = btn.dataset.role;
    const protectedUser = isProtectedCoreAdmin(user.email);
    if (protectedUser && ['removeMod', 'removeAdmin', 'banUser', 'denyAccess', 'deleteDuplicate', 'deleteAccount'].includes(role)) {
      if (!isSelfRow(user)) {
        alert('This core admin account cannot be modified.');
        return;
      }
    }

    const ref = doc(db, 'profiles', user.id);

    if (role === 'grantMod') await updateDoc(ref, { isModerator: true, updatedAt: Date.now() });
    if (role === 'removeMod') await updateDoc(ref, { isModerator: false, updatedAt: Date.now() });
    if (role === 'grantAdmin') await updateDoc(ref, { isAdmin: true, manualVerified: true, accessApproved: true, accessManuallyDenied: false, approvedAt: Date.now(), approvedBy: normalizeEmail(currentViewer?.email), updatedAt: Date.now() });
    if (role === 'removeAdmin') await updateDoc(ref, { isAdmin: false, updatedAt: Date.now() });
    if (role === 'approveAccess') await updateDoc(ref, { manualVerified: true, accessApproved: true, accessManuallyDenied: false, approvedAt: Date.now(), approvedBy: normalizeEmail(currentViewer?.email), updatedAt: Date.now() });
    if (role === 'denyAccess') {
      const denyPayload = { accessApproved: false, accessManuallyDenied: true, updatedAt: Date.now() };
      if (!user.emailVerified) denyPayload.manualVerified = false;
      await updateDoc(ref, denyPayload);
    }
    if (role === 'banUser') await updateDoc(ref, { banned: true, updatedAt: Date.now() });
    if (role === 'unbanUser') await updateDoc(ref, { banned: false, updatedAt: Date.now() });
    if (role === 'setTempPassword') {
      const suggested = generateTempPassword();
      const temporaryPassword = window.prompt(`Set a temporary password for ${user.email}. Share it with the user and they will be forced to change it after login.`, suggested);
      if (temporaryPassword === null) return;
      if (String(temporaryPassword).trim().length < 8) {
        alert('Temporary password must be at least 8 characters.');
        return;
      }
      const result = await callSetMarketplaceTempPassword(user, String(temporaryPassword).trim());
      const copied = await copyText(String(temporaryPassword).trim());
      alert(`${result?.message || 'Temporary password saved.'}${result?.note ? ` ${result.note}` : ''}${copied ? ' The password was also copied to your clipboard.' : ''}${user.accessApproved ? '' : ' This account still needs manual approval before the user can log in.'}`);
      return;
    }
    if (role === 'deleteAccount') {
      const selfRow = isSelfRow(user);
      const confirmWord = window.prompt(`Type DELETE to permanently remove ${user.email || 'this account'} from the marketplace. This will delete their listings and RSVP responses, block access, and keep the rest of the website intact.${selfRow ? ' You are deleting your own account.' : ''}`, '');
      if (confirmWord !== 'DELETE') return;
      const result = await disableMarketplaceAccount(user);
      alert(result?.message || 'Account removed from marketplace.');
      if (selfRow) {
        await signOut(auth).catch(() => {});
        window.location.href = 'index.html';
      }
      return;
    }
    if (role === 'deleteDuplicate') {
      if (!confirm(`Delete duplicate profile row for ${user.email}? This removes only the extra profile document.`)) return;
      await deleteDoc(ref);
    }
  });

  renderOwnerHighlights();
}

function startUsers() {
  onSnapshot(collection(db, 'profiles'), (snap) => {
    userRowsData = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderUserRows();
  });
}

function renderRsvpRows() {
  if (!$('rsvpRows')) return;
  const counts = { ATTENDING: 0, MAYBE: 0, CANT: 0 };
  const rows = eventRowsData.slice().sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0));
  rows.forEach((row) => {
    const key = String(row.status || '').toUpperCase();
    if (counts[key] !== undefined) counts[key] += 1;
  });
  if ($('rsvpAttendCount')) $('rsvpAttendCount').textContent = `${counts.ATTENDING} attending`;
  if ($('rsvpMaybeCount')) $('rsvpMaybeCount').textContent = `${counts.MAYBE} maybe`;
  if ($('rsvpCantCount')) $('rsvpCantCount').textContent = `${counts.CANT} can’t attend`;

  $('rsvpRows').innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td><div class="user-main">${esc(row.displayName || '—')}</div></td>
      <td>${esc(row.userEmail || '—')}</td>
      <td><span class="user-status-value ${row.status === 'ATTENDING' ? 'ok' : row.status === 'MAYBE' ? 'pending' : 'bad'}">${esc(row.status === 'ATTENDING' ? 'Attending' : row.status === 'MAYBE' ? 'Maybe' : "Can't Attend")}</span></td>
      <td>${esc(fmtDate(row.updatedAtMs || Date.now()))}</td>
    </tr>
  `).join('') : '<tr><td colspan="4"><div class="owner-empty">No RSVP responses yet.</div></td></tr>';

  renderOwnerHighlights();
}

function startEventResponses() {
  onSnapshot(collection(db, 'eventResponses'), (snap) => {
    eventRowsData = snap.docs
      .map((d) => ({ id:d.id, ...d.data() }))
      .filter((row) => row.eventId === 'regal-50th-anniversary-may-15-2026');
    renderRsvpRows();
  });
}

function startListings() {
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    listingRowsData = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    if ($('adminListingCount')) $('adminListingCount').textContent = String(listingRowsData.length);
    if ($('adminRequestCount')) $('adminRequestCount').textContent = String(listingRowsData.filter((r) => r.reactivationRequested).length);
    if (!$('listingRows')) return;

    $('listingRows').innerHTML = listingRowsData.length ? listingRowsData.map((item) => {
      const board = item.board || item.category || 'BUYSELL';
      const poster = item.authorName || item.displayName || item.authorEmail || item.userEmail || '—';
      const requestPill = item.reactivationRequested ? `<div class="note">Reactivation requested ${esc(fmtDate(item.reactivationRequestedAt))}</div>` : '';
      const hiddenPill = item.hidden ? `<div class="note">Hidden from marketplace view</div>` : '';
      const featuredPill = item.featured ? `<div class="note">Featured on homepage</div>` : '';
      return `
        <tr>
          <td><strong>${esc(item.title || 'Untitled')}</strong><div class="note">${esc(fmtDate(item.createdAtMs))}</div>${requestPill}${hiddenPill}${featuredPill}</td>
          <td>${esc(boardLabels[board] || board)}</td>
          <td>${esc(item.status === 'SOLD' ? getClosedLabel(item) : (item.status || 'ACTIVE'))}</td>
          <td>${esc(poster)}</td>
          <td>
            <div class="rowBtns compact-rowBtns">
              ${item.status !== 'SOLD' ? `<button class="btn" data-sold="${esc(item.id)}" type="button">${esc(getMarkClosedLabel(item))}</button>` : ''}
              ${item.status === 'SOLD' ? `<button class="btn primary" data-approve="${esc(item.id)}" type="button">Mark Active</button>` : ''}
              ${item.status === 'SOLD' && item.reactivationRequested ? `<button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny Request</button>` : ''}
              <button class="btn ghost" data-feature="${esc(item.id)}" data-on="${item.featured ? '1' : '0'}" type="button">${item.featured ? 'Unfeature' : 'Feature'}</button>
              <button class="btn ghost" data-edit="${esc(item.id)}" type="button">Edit</button>
              <button class="btn ghost" data-hide="${esc(item.id)}" data-on="${item.hidden ? '1' : '0'}" type="button">${item.hidden ? 'Unhide' : 'Hide'}</button>
              <button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('') : '<tr><td colspan="5"><div class="owner-empty">No listings found.</div></td></tr>';

    document.querySelectorAll('[data-sold]').forEach((btn) => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.sold), { status:'SOLD', reactivationRequested:false });
    });
    document.querySelectorAll('[data-approve]').forEach((btn) => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.approve), {
        status:'ACTIVE',
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt:null
      });
    });
    document.querySelectorAll('[data-deny]').forEach((btn) => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.deny), {
        reactivationRequested:false,
        reactivationRequestedAt:null,
        reactivationDeniedAt: Date.now()
      });
    });
    document.querySelectorAll('[data-feature]').forEach((btn) => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.feature), { featured: btn.dataset.on !== '1' });
    });
    document.querySelectorAll('[data-hide]').forEach((btn) => btn.onclick = async () => {
      await updateDoc(doc(db, 'listings', btn.dataset.hide), { hidden: btn.dataset.on !== '1' });
    });
    document.querySelectorAll('[data-edit]').forEach((btn) => btn.onclick = () => openEditModal(btn.dataset.edit));
    document.querySelectorAll('[data-delete]').forEach((btn) => btn.onclick = async () => {
      if (!confirm('Delete this post permanently?')) return;
      await deleteDoc(doc(db, 'listings', btn.dataset.delete));
    });

    renderOwnerHighlights();
  });
}

function ensureEditModal() {
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
          <div class="field"><label>Status</label><select id="adminEditStatus"><option value="ACTIVE">Active</option><option value="SOLD">Closed</option></select></div>
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
  document.getElementById('adminEditOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminEditOverlay') closeEditModal();
  });
  document.getElementById('adminEditSave')?.addEventListener('click', saveAdminEdit);
}
function openEditModal(id) {
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
function closeEditModal() {
  adminEditingId = null;
  const overlay = document.getElementById('adminEditOverlay');
  if (overlay) overlay.style.display = 'none';
}
async function saveAdminEdit() {
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
  if (!title || !description) {
    alert('Title and description are required.');
    return;
  }
  await updateDoc(doc(db, 'listings', adminEditingId), {
    board,
    category: board,
    status,
    title,
    price: Number(price || 0),
    location,
    description,
    desc: description,
    contact,
    featured,
    hidden
  });
  closeEditModal();
}

onAuthStateChanged(auth, async (user) => {
  currentViewer = user || null;
  ensureOwnerShell();

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

  $('userSearch')?.addEventListener('input', (e) => {
    userSearchTerm = String(e.target.value || '').trim().toLowerCase();
    renderUserRows();
  });
  $('userFilter')?.addEventListener('change', (e) => {
    userFilterValue = String(e.target.value || 'ALL');
    renderUserRows();
  });

  startListings();
  startUsers();
  startEventResponses();
});
