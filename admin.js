import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const AUTH_FUNCTION_REGION = 'us-central1';
const CORE_ADMIN_EMAILS = [
  'michael.h@regallakeland.com',
  'janni.r@regallakeland.com'
];
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const autoGrantSyncIds = new Set();

function verificationFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/resendVerificationEmail`;
}

function deleteAccountFunctionUrl() {
  return `https://${AUTH_FUNCTION_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/deleteMarketplaceAccount`;
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

async function callDeleteMarketplaceAccount(targetUser) {
  if (!currentViewer) throw new Error('You must be signed in.');
  const token = await currentViewer.getIdToken(true);
  const res = await fetch(deleteAccountFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ uid: targetUser.id, email: targetUser.email || '' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Account delete request failed (${res.status})`);
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

const $ = (id) => document.getElementById(id);
const FILTER_LABELS = {
  ALL: 'Showing all users',
  PENDING: 'Showing pending approvals',
  ONLINE: 'Showing users currently online',
  ADMIN: 'Showing admin accounts',
  MODERATOR: 'Showing moderator accounts',
  BANNED: 'Showing blocked users',
  DUPLICATES: 'Showing duplicate profiles',
  DELETED: 'Showing deleted accounts'
};
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const boardLabels = { FREE:'Free Items', BUYSELL:'Buy / Sell', GARAGE:'Garage Sales', EVENTS:'Events', PICTURES:'Pictures', WORK:'Work News', SERVICES:'Local Services' };

function fmtDate(ms) {
  try { return new Date(Number(ms || Date.now())).toLocaleString(); } catch { return '—'; }
}
function fmtAgo(ms) {
  const stamp = Number(ms || 0);
  if (!stamp) return '—';
  const diff = Math.max(0, Date.now() - stamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
function activityPrimaryMs(user) {
  const candidates = [user?.lastActivityAtMs, user?.lastSeenAtMs, user?.lastLoginAtMs, user?.createdAtMs];
  for (const value of candidates) {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}
function activityStatusMeta(user) {
  const seen = Number(user?.lastSeenAtMs || 0);
  if (seen >= Date.now() - ONLINE_WINDOW_MS) return { label: 'Online now', tone: 'online' };
  if (seen >= Date.now() - (60 * 60 * 1000)) return { label: 'Recently active', tone: 'recent' };
  return { label: 'Offline', tone: 'offline' };
}
function activityBoardText(user) {
  const view = String(user?.currentView || '').toUpperCase();
  if (view === 'THREAD' && user?.lastThreadTitle) return `Thread • ${user.lastThreadTitle}`;
  const boardKey = String(user?.lastBoardVisited || '').toUpperCase();
  if (boardLabels[boardKey]) return `Board • ${boardLabels[boardKey]}`;
  if (view && boardLabels[view]) return `View • ${boardLabels[view]}`;
  if (view === 'POST') return 'Action • Posting';
  return 'Marketplace activity';
}
function activitySummaryText(user) {
  const label = String(user?.lastActivityLabel || '').trim();
  if (label) return label;
  if (user?.lastSeenAtMs) return 'Active on marketplace';
  return 'No recent activity recorded';
}
function activitySearchBlob(user) {
  return [
    preferredUserName(user, false),
    user?.email,
    activitySummaryText(user),
    activityBoardText(user),
    user?.lastThreadTitle,
    user?.lastBoardVisited,
    user?.currentView
  ].join(' ').toLowerCase();
}
function recentActivityFilterMatch(user) {
  const seen = Number(user?.lastSeenAtMs || 0);
  const login = Number(user?.lastLoginAtMs || 0);
  const primary = Number(activityPrimaryMs(user) || 0);
  const online = seen >= Date.now() - ONLINE_WINDOW_MS;
  switch (activityFilterValue) {
    case 'ONLINE':
      return online;
    case 'OFFLINE_RECENT':
      return !online && (seen >= Date.now() - (7 * 24 * 60 * 60 * 1000) || primary >= Date.now() - (7 * 24 * 60 * 60 * 1000));
    case 'TODAY':
      return seen >= Date.now() - (24 * 60 * 60 * 1000) || primary >= Date.now() - (24 * 60 * 60 * 1000);
    case 'WEEK':
      return seen >= Date.now() - (7 * 24 * 60 * 60 * 1000) || primary >= Date.now() - (7 * 24 * 60 * 60 * 1000);
    case 'LOGINS':
      return login > 0;
    case 'RECENT':
    default:
      return true;
  }
}
function recentActivityRows(users) {
  const rows = users
    .filter((user) => !!activityPrimaryMs(user))
    .sort((a, b) => activityPrimaryMs(b) - activityPrimaryMs(a));
  return rows.filter((user) => {
    if (!recentActivityFilterMatch(user)) return false;
    if (!activitySearchTerm) return true;
    return activitySearchBlob(user).includes(activitySearchTerm);
  });
}
function approvalStateLabel(user) {
  if (user?.banned) return 'Blocked';
  if (user?.accessApproved) return 'Approved';
  if (user?.accessManuallyDenied) return 'Denied';
  return 'Waiting on admin approval';
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function normalizePersonName(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function preferredUserName(user, preferPending = false) {
  const pendingFirst = preferPending
    ? [user?.pendingName, user?.requestedName, user?.displayName]
    : [user?.displayName, user?.pendingName, user?.requestedName];
  for (const candidate of pendingFirst) {
    const clean = normalizePersonName(candidate);
    if (clean) return clean;
  }
  return normalizeEmail(user?.email) || '';
}
function isAdmin(email) { return ADMIN_EMAILS.map((x) => x.toLowerCase()).includes(normalizeEmail(email)); }
function isProtectedCoreAdmin(email) { return CORE_ADMIN_EMAILS.includes(normalizeEmail(email)); }
function isCoreAdminViewer() { return isProtectedCoreAdmin(currentViewer?.email); }
function isSelfRow(user) { return !!currentViewer && user?.id === currentViewer.uid; }

function canModerateViewer() {
  return !!(currentViewerProfile && (currentViewerProfile.isAdmin || currentViewerProfile.isModerator || isProtectedCoreAdmin(currentViewer?.email) || isAdmin(currentViewer?.email)));
}

function canManageUsers() {
  return !!(currentViewerProfile && (currentViewerProfile.isAdmin || isProtectedCoreAdmin(currentViewer?.email) || isAdmin(currentViewer?.email)));
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
  return {
    flagged: matchedLabels.length > 0,
    matchedLabels: [...new Set(matchedLabels)],
    matchedTerms: [...new Set(matchedTerms)].slice(0, 12)
  };
}

function buildSnippet(value, max = 220) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…` : clean;
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

function shouldAutoGrantAccess(user) {
  const emailApproved = !!(user?.emailVerified || user?.manualVerified);
  return emailApproved && !user?.banned && !user?.accessApproved && !user?.accessManuallyDenied;
}

function generateTempPassword() {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const tail = Math.random().toString(36).slice(-4);
  return `Regal!${digits}${tail}`;
}

function approvalPatch() {
  return {
    manualVerified: true,
    accessApproved: true,
    accessManuallyDenied: false,
    approvalStatus: 'APPROVED',
    pendingApprovalAtMs: null,
    banned: false,
    deleted: false,
    approvedAt: Date.now(),
    approvedBy: normalizeEmail(currentViewer?.email),
    lastLoginBlockedReason: '',
    lastLoginBlockedAtMs: null,
    updatedAt: Date.now()
  };
}

function accessStatusMeta(user) {
  if (user?.banned) return { label: 'Blocked', tone: 'bad' };
  if (user?.accessApproved) return { label: 'Granted', tone: 'ok' };
  if (user?.accessManuallyDenied) return { label: 'Denied', tone: 'bad' };
  return { label: 'Pending', tone: 'pending' };
}

function normalizeApprovalStatus(user) {
  if (!user) return 'PENDING_ADMIN_APPROVAL';
  if (user.deleted) return 'DELETED';
  if (user.accessManuallyDenied) return 'DENIED';
  if (user.accessApproved === true) return 'APPROVED';
  const raw = String(user.approvalStatus || '').trim().toUpperCase();
  if (raw === 'APPROVED' || raw === 'DENIED' || raw === 'DELETED') return raw;
  return 'PENDING_ADMIN_APPROVAL';
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
  if (!preferredUserName(user, true)) flags.push('Name missing');
  if (user?.mustChangePassword) flags.push('Temp password active');
  if (!user?.rulesAccepted) flags.push('Rules pending');
  return flags.length ? flags.join(' • ') : '—';
}

function formatRulesStatus(user) {
  if (!user?.rulesAccepted) return 'Pending employee agreement';
  const acceptedName = normalizePersonName(user.rulesAcceptedName) || preferredUserName(user, true) || user.email || '—';
  const acceptedAt = fmtDate(user.rulesAcceptedAtMs || user.updatedAt || user.createdAtMs || Date.now());
  const version = user.rulesAcceptedVersion || '—';
  const byEmail = user.rulesAcceptedByEmail || user.email || '—';
  return `Accepted by ${acceptedName} on ${acceptedAt} • ${version} • ${byEmail}`;
}

let authResolved = false;
let currentViewer = null;
let currentViewerProfile = null;
let listingRowsData = [];
let replyRowsData = [];
let moderationFlagsData = [];
let userRowsData = [];
let eventPhotoRowsData = [];
let adminEditingId = null;
let moderationListingId = null;
let userSearchTerm = '';
let userFilterValue = 'PENDING';
let activitySearchTerm = '';
let activityFilterValue = 'RECENT';
let activityLimitValue = '50';

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
  const allowed = !!(isProtectedCoreAdmin(user.email) || currentViewerProfile?.isAdmin || currentViewerProfile?.isModerator || isAdmin(user.email));
  if (!allowed) {
    alert('Moderator or admin access only.');
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
    syncAdminFilterUi();
    renderUserRows();
  });
  $('adminActivitySearch')?.addEventListener('input', (e) => {
    activitySearchTerm = String(e.target.value || '').trim().toLowerCase();
    renderRecentActivity();
  });
  $('adminActivityFilter')?.addEventListener('change', (e) => {
    activityFilterValue = String(e.target.value || 'RECENT');
    renderRecentActivity();
  });
  $('adminActivityLimit')?.addEventListener('change', (e) => {
    activityLimitValue = String(e.target.value || '50');
    renderRecentActivity();
  });
  document.querySelectorAll('[data-admin-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      userFilterValue = String(btn.dataset.adminFilter || 'ALL');
      if ($('userFilter')) $('userFilter').value = userFilterValue;
      syncAdminFilterUi();
      renderUserRows();
    });
  });
  syncAdminFilterUi();

  if (!canManageUsers()) {
    if ($('userAccessPanel')) $('userAccessPanel').style.display = 'none';
  }

  startListings();
  startReplies();
  startModerationFlags();
  startEventPhotos();
  if (canManageUsers()) startUsers();
});



function syncAdminFilterUi() {
  if ($('adminActiveFilterLabel')) $('adminActiveFilterLabel').textContent = FILTER_LABELS[userFilterValue] || FILTER_LABELS.ALL;
  document.querySelectorAll('[data-admin-filter]').forEach((btn) => {
    btn.classList.toggle('active', String(btn.dataset.adminFilter || '') === userFilterValue);
  });
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function getReplyRowsForListing(listingId) {
  return replyRowsData
    .filter((reply) => reply.listingId === listingId)
    .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
}

function getOpenFlagsForListing(listingId) {
  return moderationFlagsData.filter((flag) => flag.listingId === listingId && String(flag.status || 'OPEN').toUpperCase() === 'OPEN');
}

function mergedRepliesForListing(item) {
  const legacyReplies = Array.isArray(item?.replies)
    ? item.replies.map((reply, index) => {
        const scan = detectModerationIssues(reply?.text || '');
        return {
          source: 'legacy',
          sourceKey: `legacyReply:${item.id}:${index}`,
          listingId: item.id,
          listingTitle: item.title || '',
          legacyIndex: index,
          displayName: reply?.displayName || reply?.userEmail || 'Unknown',
          userEmail: reply?.userEmail || '',
          text: reply?.text || '',
          textSnippet: buildSnippet(reply?.text || '', 160),
          createdAtMs: Number(reply?.createdAtMs || reply?.createdAt || Date.now()),
          deleted: reply?.deleted === true,
          hidden: reply?.hidden === true,
          flagged: reply?.flagged === true || scan.flagged,
          moderationLabels: Array.isArray(reply?.moderationLabels) && reply.moderationLabels.length ? reply.moderationLabels : scan.matchedLabels,
          moderationMatchedTerms: Array.isArray(reply?.moderationMatchedTerms) && reply.moderationMatchedTerms.length ? reply.moderationMatchedTerms : scan.matchedTerms
        };
      })
    : [];

  const liveReplies = getReplyRowsForListing(item.id).map((reply) => ({
    ...reply,
    source: 'doc',
    sourceKey: reply.sourceKey || `reply:${reply.id}`,
    listingTitle: reply.listingTitle || item.title || '',
    displayName: reply.displayName || reply.userEmail || 'Unknown',
    textSnippet: reply.textSnippet || buildSnippet(reply.text || '', 160),
    flagged: reply.flagged === true || (Array.isArray(reply.moderationLabels) && reply.moderationLabels.length > 0)
  }));

  return [...legacyReplies, ...liveReplies].sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
}

function listingThreadStats(item) {
  const replies = mergedRepliesForListing(item).filter((reply) => reply.deleted !== true);
  const openFlags = getOpenFlagsForListing(item.id);
  const flaggedPost = item.moderationFlagged === true;
  return {
    replyCount: replies.length,
    openFlagCount: openFlags.length + (flaggedPost ? 1 : 0),
    lastReplyAtMs: Number(item.lastReplyAtMs || 0)
  };
}

function isSystemSitePage(item) {
  if (!item) return false;
  const board = String(item.board || item.category || '').trim().toUpperCase();
  const title = String(item.title || '').trim().toUpperCase();
  const id = String(item.id || '').trim().toLowerCase();
  return board === 'PICTURES' && (id === 'pictures-home' || title === 'PICTURES HOME');
}

function renderSitePageRows() {
  const wrap = $('sitePageRows');
  if (!wrap) return;
  const rows = listingRowsData.filter((item) => isSystemSitePage(item));
  if (!rows.length) {
    wrap.innerHTML = '<tr><td colspan="6"><div class="note">No system pages found.</div></td></tr>';
    return;
  }

  wrap.innerHTML = rows.map((item) => {
    const pageType = item.board || item.category || 'Page';
    const visibility = item.hidden ? 'Hidden from marketplace feed' : 'Visible in marketplace feed';
    const updatedMs = Number(item.updatedAt || item.createdAtMs || 0);
    const openHref = pageType.toUpperCase() === 'PICTURES' ? 'pictures.html' : 'index.html';
    const studioHref = pageType.toUpperCase() === 'PICTURES' ? 'pictures.html?edit=1' : openHref;
    return `
      <tr>
        <td><strong>${esc(item.title || 'System Page')}</strong><div class="note">System-managed page record</div></td>
        <td>${esc(boardLabels[pageType] || pageType)}</td>
        <td>${esc(String(item.status || 'ACTIVE').toUpperCase())}</td>
        <td>${esc(visibility)}</td>
        <td>${esc(fmtDate(updatedMs))}</td>
        <td><div class="rowBtns compact-rowBtns"><a class="btn" href="${openHref}" target="_blank" rel="noopener">Open Page</a><a class="btn ghost" href="${studioHref}" target="_blank" rel="noopener">Open Studio</a></div></td>
      </tr>`;
  }).join('');
}

function renderListingRows() {
  if (!$('listingRows')) return;
  const adminViewer = canManageUsers();
  const rows = listingRowsData.filter((item) => !isSystemSitePage(item));
  $('listingRows').innerHTML = rows.map((item) => {
    const board = item.board || item.category || 'BUYSELL';
    const poster = item.authorName || item.displayName || item.authorEmail || item.userEmail || '—';
    const requestPill = item.reactivationRequested ? `<div class="note">Reactivation requested ${esc(fmtDate(item.reactivationRequestedAt))}</div>` : '';
    const hiddenPill = item.hidden ? `<div class="note">Hidden from marketplace view</div>` : '';
    const featuredPill = item.featured ? `<div class="note">Featured on homepage</div>` : '';
    const stats = listingThreadStats(item);
    const threadBits = [
      `<span class="mod-chip ${stats.replyCount ? 'good' : ''}">${stats.replyCount} repl${stats.replyCount === 1 ? 'y' : 'ies'}</span>`,
      `<span class="mod-chip ${stats.openFlagCount ? 'flagged' : ''}">${stats.openFlagCount} open flag${stats.openFlagCount === 1 ? '' : 's'}</span>`
    ];
    if (stats.lastReplyAtMs) threadBits.push(`<span class="mod-chip">Last reply ${esc(fmtDate(stats.lastReplyAtMs))}</span>`);
    if (item.moderationFlagged) threadBits.push('<span class="mod-chip bad">Post flagged</span>');

    const actions = [];
    if (adminViewer && item.status !== 'SOLD') actions.push(`<button class="btn" data-sold="${esc(item.id)}" type="button">${esc(getMarkClosedLabel(item))}</button>`);
    if (adminViewer && item.status === 'SOLD') actions.push(`<button class="btn primary" data-approve="${esc(item.id)}" type="button">Mark Active</button>`);
    if (adminViewer && item.status === 'SOLD' && item.reactivationRequested) actions.push(`<button class="btn ghost" data-deny="${esc(item.id)}" type="button">Deny Request</button>`);
    if (adminViewer) actions.push(`<button class="btn ghost" data-feature="${esc(item.id)}" data-on="${item.featured ? '1' : '0'}" type="button">${item.featured ? 'Unfeature' : 'Feature'}</button>`);
    if (adminViewer) actions.push(`<button class="btn ghost" data-edit="${esc(item.id)}" type="button">Edit</button>`);
    actions.push(`<button class="btn primary" data-thread="${esc(item.id)}" type="button">Moderate Thread</button>`);
    actions.push(`<button class="btn ghost" data-hide="${esc(item.id)}" data-on="${item.hidden ? '1' : '0'}" type="button">${item.hidden ? 'Unhide' : 'Hide'}</button>`);
    actions.push(`<button class="btn danger" data-delete="${esc(item.id)}" type="button">Delete</button>`);

    return `
      <tr>
        <td><strong>${esc(item.title || 'Untitled')}</strong><div class="note">${esc(fmtDate(item.createdAtMs))}</div>${requestPill}${hiddenPill}${featuredPill}</td>
        <td>${esc(boardLabels[board] || board)}</td>
        <td>${esc(item.status === 'SOLD' ? getClosedLabel(item) : (item.status || 'ACTIVE'))}</td>
        <td>${esc(poster)}</td>
        <td><div class="mod-stat-stack"><div class="mod-stat-line">${threadBits.join('')}</div></div></td>
        <td><div class="rowBtns compact-rowBtns">${actions.join('')}</div></td>
      </tr>`;
  }).join('');

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
  document.querySelectorAll('[data-thread]').forEach((btn) => btn.onclick = () => openModerationModal(btn.dataset.thread));
  document.querySelectorAll('[data-delete]').forEach((btn) => btn.onclick = async () => {
    const item = listingRowsData.find((row) => row.id === btn.dataset.delete);
    if (!item) return;
    if (!confirm('Permanently delete this post and all of its replies? This fully removes the thread from the website.')) return;
    await deleteListingAndResolve(item);
  });
}


function renderEventPhotoRows() {
  const wrap = $('adminEventPhotoRows');
  if (!wrap) return;
  const rows = [...eventPhotoRowsData].sort((a, b) => {
    const ap = a.status === 'PENDING' ? 1 : 0;
    const bp = b.status === 'PENDING' ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });
  const pending = rows.filter((x) => x.status === 'PENDING').length;
  if ($('adminEventPhotoPendingCount')) $('adminEventPhotoPendingCount').textContent = `${pending} pending`;
  if (!rows.length) {
    wrap.innerHTML = '<div class="admin-empty-note">No anniversary photos have been submitted yet.</div>';
    return;
  }
  wrap.innerHTML = rows.map((photo) => {
    const isPending = photo.status === 'PENDING';
    const isApproved = photo.status === 'APPROVED';
    const statusClass = isPending ? 'pending' : (isApproved ? 'active' : 'sold');
    return `
      <article class="eventPhotoAdminCard">
        <a href="${escAttr(photo.imageUrl || '')}" target="_blank" rel="noopener noreferrer">
          <img src="${escAttr(photo.imageUrl || '')}" alt="${escAttr(photo.caption || '50th Anniversary photo')}" loading="lazy" />
        </a>
        <div class="eventPhotoAdminBody">
          <div class="eventPhotoAdminTop"><span class="status ${statusClass}">${esc(photo.status || 'PENDING')}</span><span class="note">${esc(fmtDate(photo.createdAtMs || Date.now()))}</span></div>
          <div class="user-main">${esc(photo.caption || 'No caption')}</div>
          <div class="note">Uploaded by ${esc(photo.displayName || photo.userEmail || 'Unknown')}</div>
          <div class="rowBtns compact-rowBtns">
            ${!isApproved ? `<button class="btn primary" data-event-photo-approve="${escAttr(photo.id)}" type="button">Approve</button>` : `<button class="btn ghost" data-event-photo-hide="${escAttr(photo.id)}" type="button">Hide</button>`}
            ${isApproved && photo.hidden ? `<button class="btn primary" data-event-photo-approve="${escAttr(photo.id)}" type="button">Show</button>` : ''}
            <button class="btn danger" data-event-photo-delete="${escAttr(photo.id)}" type="button">Delete</button>
          </div>
        </div>
      </article>`;
  }).join('');

  document.querySelectorAll('[data-event-photo-approve]').forEach((btn) => btn.onclick = async () => {
    if (!canModerateViewer()) return;
    await updateDoc(doc(db, 'eventPhotos', btn.dataset.eventPhotoApprove), {
      status: 'APPROVED',
      hidden: false,
      approvedAtMs: Date.now(),
      approvedBy: currentViewer?.email || '',
      updatedAtMs: Date.now()
    });
  });
  document.querySelectorAll('[data-event-photo-hide]').forEach((btn) => btn.onclick = async () => {
    if (!canModerateViewer()) return;
    await updateDoc(doc(db, 'eventPhotos', btn.dataset.eventPhotoHide), {
      status: 'HIDDEN',
      hidden: true,
      updatedAtMs: Date.now()
    });
  });
  document.querySelectorAll('[data-event-photo-delete]').forEach((btn) => btn.onclick = async () => {
    if (!canModerateViewer()) return;
    if (!confirm('Delete this event photo submission?')) return;
    await deleteDoc(doc(db, 'eventPhotos', btn.dataset.eventPhotoDelete));
  });
}

function startEventPhotos() {
  onSnapshot(query(collection(db, 'eventPhotos'), orderBy('createdAtMs', 'desc')), (snap) => {
    eventPhotoRowsData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEventPhotoRows();
  }, (err) => console.error('Event photos admin error:', err));
}

function startListings() {
  const qRef = query(collection(db, 'listings'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    listingRowsData = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    renderListingRows();
    renderSitePageRows();
    renderModerationRows();
    renderModerationModal();
  });
}

function startReplies() {
  const qRef = query(collectionGroup(db, 'replies'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    replyRowsData = snap.docs.map((d) => ({ id: d.id, path: d.ref.path, sourceKey: `reply:${d.id}`, ...d.data() }));
    if ($('adminReplyCount')) $('adminReplyCount').textContent = `${replyRowsData.filter((reply) => reply.deleted !== true).length} replies`;
    renderListingRows();
    renderSitePageRows();
    renderModerationModal();
  });
}

function startModerationFlags() {
  const qRef = query(collection(db, 'moderationFlags'), orderBy('createdAtMs', 'desc'));
  onSnapshot(qRef, (snap) => {
    moderationFlagsData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderModerationRows();
    renderListingRows();
    renderSitePageRows();
    renderModerationModal();
  });
}

async function resolveFlagsForSource(sourceKey, resolution = 'reviewed') {
  const openFlags = moderationFlagsData.filter((flag) => flag.sourceKey === sourceKey && String(flag.status || 'OPEN').toUpperCase() === 'OPEN');
  await Promise.all(openFlags.map((flag) => updateDoc(doc(db, 'moderationFlags', flag.id), {
    status: 'RESOLVED',
    resolvedAtMs: Date.now(),
    resolvedBy: normalizeEmail(currentViewer?.email),
    resolution
  })));
}

async function resolveFlagsForListing(listingId, resolution = 'reviewed') {
  const openFlags = moderationFlagsData.filter((flag) => flag.listingId === listingId && String(flag.status || 'OPEN').toUpperCase() === 'OPEN');
  await Promise.all(openFlags.map((flag) => updateDoc(doc(db, 'moderationFlags', flag.id), {
    status: 'RESOLVED',
    resolvedAtMs: Date.now(),
    resolvedBy: normalizeEmail(currentViewer?.email),
    resolution
  })));
}

async function deleteFlagDocsForListing(listingId = '', replyId = '') {
  const requests = [];
  if (replyId) requests.push(getDocs(query(collection(db, 'moderationFlags'), where('replyId', '==', replyId))));
  else if (listingId) requests.push(getDocs(query(collection(db, 'moderationFlags'), where('listingId', '==', listingId))));
  if (!requests.length) return;
  const results = await Promise.all(requests);
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
    lastReplyPreview: lastReply?.text ? String(lastReply.text).slice(0, 120) : '',
    lastReplyByUid: lastReply?.uid || '',
    lastReplyByEmail: lastReply?.userEmail || '',
    updatedAt: Date.now()
  }).catch(() => {});
}

async function deleteListingAndResolve(item) {
  const listingId = item?.id;
  if (!listingId) return;
  const repliesSnap = await getDocs(query(collection(db, 'listings', listingId, 'replies'), orderBy('createdAtMs', 'asc'))).catch(() => null);
  if (repliesSnap) {
    await Promise.all(repliesSnap.docs.map((replyDoc) => deleteDoc(replyDoc.ref).catch(() => {})));
  }
  await deleteFlagDocsForListing(listingId).catch(() => {});
  await deleteDoc(doc(db, 'listings', listingId));
  if (moderationListingId === listingId) closeModerationModal();
}

function renderModerationRows() {
  const wrap = $('moderationRows');
  if (!wrap) return;
  const openFlags = moderationFlagsData.filter((flag) => String(flag.status || 'OPEN').toUpperCase() === 'OPEN');
  if ($('adminFlagOpenCount')) $('adminFlagOpenCount').textContent = `${openFlags.length} open`;
  setText('adminFlagOpenCountHero', String(openFlags.length));
  if (!openFlags.length) {
    wrap.innerHTML = '<tr><td colspan="6"><div class="note">No flagged content is currently waiting for review.</div></td></tr>';
    return;
  }
  wrap.innerHTML = openFlags.slice(0, 100).map((flag) => {
    const typeLabel = flag.sourceType === 'reply' ? 'Reply' : 'Post';
    const reasonText = Array.isArray(flag.matchedLabels) && flag.matchedLabels.length ? flag.matchedLabels.join(' • ') : 'Review';
    return `
      <tr>
        <td>${esc(fmtDate(flag.createdAtMs || Date.now()))}</td>
        <td>${esc(typeLabel)}</td>
        <td>${esc(flag.listingTitle || 'Untitled post')}</td>
        <td><div class="moderation-content">${esc(flag.textSnippet || '—')}</div><div class="note">${esc(flag.displayName || flag.userEmail || 'Unknown')}</div></td>
        <td>${esc(reasonText)}</td>
        <td>
          <div class="rowBtns compact-rowBtns">
            <button class="btn primary" data-flag-open="${esc(flag.listingId || '')}" type="button">Open Thread</button>
            <button class="btn ghost" data-flag-resolve="${esc(flag.sourceKey || '')}" type="button">Mark Reviewed</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('[data-flag-open]').forEach((btn) => btn.onclick = () => openModerationModal(btn.dataset.flagOpen));
  document.querySelectorAll('[data-flag-resolve]').forEach((btn) => btn.onclick = async () => {
    await resolveFlagsForSource(btn.dataset.flagResolve, 'reviewed');
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
  if (!user || user.deleted || user.banned) return false;
  if (user.accessApproved === true) return false;
  const status = normalizeApprovalStatus(user);
  if (status === 'APPROVED' || status === 'DENIED' || status === 'DELETED') return false;
  return true;
}

function applyUserFilters(rows) {
  const dmeta = duplicateMeta(rows);
  let filtered = rows.slice();
  if (userSearchTerm) {
    filtered = filtered.filter((user) => {
      const hay = [user.email, user.displayName, user.pendingName, user.requestedName, preferredUserName(user, true)].join(' ').toLowerCase();
      return hay.includes(userSearchTerm);
    });
  }
  if (userFilterValue === 'PENDING') filtered = filtered.filter(userPending);
  if (userFilterValue === 'ONLINE') filtered = filtered.filter((u) => u.accessApproved && !u.banned && Number(u.lastSeenAtMs || 0) >= (Date.now() - ONLINE_WINDOW_MS));
  if (userFilterValue === 'ADMIN') filtered = filtered.filter((u) => !!u.isAdmin || isProtectedCoreAdmin(u.email));
  if (userFilterValue === 'MODERATOR') filtered = filtered.filter((u) => !!u.isModerator);
  if (userFilterValue === 'BANNED') filtered = filtered.filter((u) => !!u.banned);
  if (userFilterValue === 'DUPLICATES') filtered = filtered.filter((u) => dmeta.get(u.id)?.isDuplicate);
  if (userFilterValue === 'DELETED') filtered = filtered.filter((u) => !!u.deleted);
  
  if (userFilterValue === 'ONLINE') {
    filtered.sort((a, b) => Number(b.lastSeenAtMs || 0) - Number(a.lastSeenAtMs || 0));
  } else if (userFilterValue === 'PENDING') {
    filtered.sort((a, b) => Number(b.signupSubmittedAtMs || b.createdAtMs || 0) - Number(a.signupSubmittedAtMs || a.createdAtMs || 0));
  } else {
    filtered.sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email)) || preferredUserName(a, true).localeCompare(preferredUserName(b, true)));
  }
  return { filtered, dmeta };
}

function buildUserActionButtons(user, dup, protectedUser) {
  const buttons = [];
  const selfRow = isSelfRow(user);

  if (!user.isModerator) buttons.push(`<button class="btn ghost" data-role="grantMod" data-id="${esc(user.id)}" type="button">Grant Moderator</button>`);
  if (user.isModerator && !protectedUser) buttons.push(`<button class="btn ghost" data-role="removeMod" data-id="${esc(user.id)}" type="button">Remove Moderator</button>`);

  if (!user.isAdmin) buttons.push(`<button class="btn" data-role="grantAdmin" data-id="${esc(user.id)}" type="button">Grant Admin</button>`);
  if (user.isAdmin && !protectedUser) buttons.push(`<button class="btn ghost" data-role="removeAdmin" data-id="${esc(user.id)}" type="button">Remove Admin</button>`);

  if (!user.accessApproved) buttons.push(`<button class="btn primary" data-role="approveAccess" data-id="${esc(user.id)}" type="button">Approve User</button>`);
  if (user.accessApproved && !protectedUser) buttons.push(`<button class="btn ghost" data-role="denyAccess" data-id="${esc(user.id)}" type="button">Remove Access</button>`);

  if (!protectedUser || selfRow) buttons.push(`<button class="btn ghost" data-role="setTempPassword" data-id="${esc(user.id)}" type="button">Set Temp Password</button>`);
  buttons.push(`<button class="btn ghost" data-role="resetRules" data-id="${esc(user.id)}" type="button">Reset Rules</button>`);
  if (isCoreAdminViewer() && (!protectedUser || selfRow)) {
    if (!user.deleted) buttons.push(`<button class="btn danger" data-role="softDeleteAccount" data-id="${esc(user.id)}" type="button">Soft Delete</button>`);
    buttons.push(`<button class="btn danger" data-role="hardDeleteAccount" data-id="${esc(user.id)}" style="background:transparent; border-color:#ef4444; color:#ef4444;" type="button">Perm Delete</button>`);
  }

  if (!user.banned && !protectedUser) buttons.push(`<button class="btn danger" data-role="banUser" data-id="${esc(user.id)}" type="button">Block</button>`);
  if (user.banned && !protectedUser) buttons.push(`<button class="btn ghost" data-role="unbanUser" data-id="${esc(user.id)}" type="button">Restore</button>`);

  if (dup.isDuplicate && !dup.isPrimary && !protectedUser) buttons.push(`<button class="btn danger" data-role="deleteDuplicate" data-id="${esc(user.id)}" type="button">Delete Duplicate</button>`);

  if (!buttons.length && protectedUser && !selfRow) {
    buttons.push('<span class="pill">Protected</span>');
  }

  return buttons.join('');
}

function renderRecentActivity() {
  if (!$('adminRecentActivityFeed')) return;

  const rows = userRowsData
    .filter((user) => !!activityPrimaryMs(user))
    .sort((a, b) => activityPrimaryMs(b) - activityPrimaryMs(a));

  const last24h = rows.filter((user) => Number(user?.lastSeenAtMs || activityPrimaryMs(user) || 0) >= Date.now() - (24 * 60 * 60 * 1000));
  const last7d = rows.filter((user) => Number(user?.lastSeenAtMs || activityPrimaryMs(user) || 0) >= Date.now() - (7 * 24 * 60 * 60 * 1000));
  const offlineRecent = last24h.filter((user) => Number(user?.lastSeenAtMs || 0) < Date.now() - ONLINE_WINDOW_MS);

  if ($('adminRecent24hCount')) $('adminRecent24hCount').textContent = `${last24h.length} active today`;
  if ($('adminRecent7dCount')) $('adminRecent7dCount').textContent = `${last7d.length} active this week`;
  if ($('adminOfflineRecentCount')) $('adminOfflineRecentCount').textContent = String(offlineRecent.length);

  const newestVisit = rows[0] || null;
  if ($('adminMostRecentUser')) $('adminMostRecentUser').textContent = newestVisit ? (preferredUserName(newestVisit, false) || newestVisit.email || '—') : '—';
  if ($('adminMostRecentMeta')) $('adminMostRecentMeta').textContent = newestVisit
    ? `${fmtAgo(activityPrimaryMs(newestVisit))} • ${fmtDate(activityPrimaryMs(newestVisit))}`
    : 'No recent activity recorded yet.';

  const newestLogin = rows
    .filter((user) => Number(user?.lastLoginAtMs || 0) > 0)
    .sort((a, b) => Number(b.lastLoginAtMs || 0) - Number(a.lastLoginAtMs || 0))[0] || null;
  if ($('adminLastLoginUser')) $('adminLastLoginUser').textContent = newestLogin ? (preferredUserName(newestLogin, false) || newestLogin.email || '—') : '—';
  if ($('adminLastLoginMeta')) $('adminLastLoginMeta').textContent = newestLogin
    ? `${fmtAgo(newestLogin.lastLoginAtMs)} • ${fmtDate(newestLogin.lastLoginAtMs)}`
    : 'No login activity recorded yet.';

  const filteredRows = recentActivityRows(userRowsData);
  const limit = activityLimitValue === 'ALL' ? filteredRows.length : Math.max(1, Number(activityLimitValue || 50));
  const feedRows = filteredRows.slice(0, limit);

  if ($('adminActivityResultsCount')) {
    $('adminActivityResultsCount').textContent = `${feedRows.length} shown • ${filteredRows.length} matched`;
  }

  if (!feedRows.length) {
    $('adminRecentActivityFeed').innerHTML = '<tr><td colspan="6"><div class="admin-empty-note">No recent activity matched your current filter.</div></td></tr>';
    return;
  }

  $('adminRecentActivityFeed').innerHTML = feedRows.map((user) => {
    const status = activityStatusMeta(user);
    const name = esc(preferredUserName(user, false) || user.email || '—');
    const email = esc(user.email || '');
    const activityAt = activityPrimaryMs(user);
    const summary = esc(activitySummaryText(user));
    const board = esc(activityBoardText(user));
    const seenAgo = user?.lastSeenAtMs ? fmtAgo(user.lastSeenAtMs) : 'No presence heartbeat';
    const seenDate = user?.lastSeenAtMs ? fmtDate(user.lastSeenAtMs) : '—';
    const loginAgo = user?.lastLoginAtMs ? fmtAgo(user.lastLoginAtMs) : 'No login';
    const loginDate = user?.lastLoginAtMs ? fmtDate(user.lastLoginAtMs) : '—';
    return `
      <tr class="activity-table-row">
        <td>
          <div class="activity-row-user">
            <div class="activity-row-name">${status.tone === 'online' ? '<span class="activity-icon-dot"></span>' : ''}${name}</div>
            <div class="activity-row-email">${email || 'No email available'}</div>
          </div>
        </td>
        <td><span class="activity-status-badge ${status.tone}">${esc(status.label)}</span></td>
        <td>
          <div class="activity-cell-primary">${summary}</div>
          <div class="activity-cell-secondary">Updated ${esc(fmtAgo(activityAt))} • ${esc(fmtDate(activityAt))}</div>
        </td>
        <td>
          <div class="activity-cell-primary">${board}</div>
          <div class="activity-cell-secondary">Context from latest tracked action</div>
        </td>
        <td>
          <div class="activity-cell-primary">${esc(seenAgo)}</div>
          <div class="activity-cell-secondary">${esc(seenDate)}</div>
        </td>
        <td>
          <div class="activity-cell-primary">${esc(loginAgo)}</div>
          <div class="activity-cell-secondary">${esc(loginDate)}</div>
        </td>
      </tr>`;
  }).join('');
}

function renderUserRows() {
  if (!canManageUsers()) return;
  if (!$('userRows')) return;
  const { filtered, dmeta } = applyUserFilters(userRowsData);

  const onlineUsers = userRowsData.filter((u) => u.accessApproved && !u.banned && Number(u.lastSeenAtMs || 0) >= (Date.now() - ONLINE_WINDOW_MS));
  if ($('adminOnlineCount')) $('adminOnlineCount').textContent = `${onlineUsers.length} online`;
  if ($('adminUserCount')) $('adminUserCount').textContent = `${userRowsData.length} users`;
  if ($('adminPendingCount')) $('adminPendingCount').textContent = `${userRowsData.filter(userPending).length} pending`;

  const pendingCount = userRowsData.filter(userPending).length;
  const blockedCount = userRowsData.filter((u) => !!u.banned).length;
  const deletedCount = userRowsData.filter((u) => !!u.deleted).length;
  const duplicateCount = Array.from(dmeta.values()).filter((meta) => meta.isDuplicate).length;

  setText('adminOnlineCountHero', String(onlineUsers.length));
  setText('adminPendingCountHero', String(pendingCount));
  setText('adminBlockedCount', String(blockedCount));
  setText('adminDeletedCount', String(deletedCount));
  setText('adminDuplicateCount', String(duplicateCount));
  syncAdminFilterUi();
  renderRecentActivity();

  if ($('adminOnlineNames')) {
    if (onlineUsers.length > 0) {
      $('adminOnlineNames').innerHTML = onlineUsers.map((u) => {
        const name = esc(preferredUserName(u, false) || u.email);
        const seen = u.lastSeenAtMs ? esc(fmtDate(u.lastSeenAtMs)) : 'Active now';
        return `<span class="online-chip"><span class="online-dot"></span><span>${name}</span><small>${seen}</small></span>`;
      }).join('');
    } else {
      $('adminOnlineNames').innerHTML = '<div class="admin-empty-note">No users are currently online.</div>';
    }
  }

  $('userRows').innerHTML = filtered.map((user) => {
    const protectedUser = isProtectedCoreAdmin(user.email);
    const dup = dmeta.get(user.id) || { isDuplicate:false, isPrimary:true, count:1 };
    const emailState = emailStatusMeta(user);
    const accessState = accessStatusMeta(user);
    const actions = buildUserActionButtons(user, dup, protectedUser);
    const shownName = preferredUserName(user, userPending(user)) || '—';
    const signupName = preferredUserName(user, true) || '—';
    const isOnline = user.accessApproved && !user.banned && Number(user.lastSeenAtMs || 0) >= (Date.now() - ONLINE_WINDOW_MS);
    const onlineDot = isOnline ? `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; margin-left:8px; box-shadow:0 0 6px #22c55e;" title="Online Now"></span>` : '';

    return `
      <tr>
        <td>
          <div class="user-main">${esc(user.email || '—')}</div>
          <div class="note user-id">UID: ${esc(user.uid || user.id)}</div>
        </td>
        <td>
          <div class="user-main" style="display:flex; align-items:center;">${esc(shownName)}${onlineDot}</div>
          <div class="note">Last seen: ${user.lastSeenAtMs ? esc(fmtDate(user.lastSeenAtMs)) : 'Never'}</div>
          <div class="note">Created / updated: ${esc(fmtDate(user.createdAtMs || user.emailVerifiedAt || Date.now()))}</div>
        </td>
        <td>
          <div class="user-status-stack">
            <div class="user-status-line"><span class="user-status-key">Email</span><span class="user-status-value ${emailState.tone}">${esc(emailState.label)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Access</span><span class="user-status-value ${accessState.tone}">${esc(accessState.label)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Full Name</span><span class="user-status-meta">${esc(shownName)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Signup Name</span><span class="user-status-meta">${esc(signupName)}</span></div>
            <div class="user-status-line"><span class="user-status-key">Approval</span><span class="user-status-meta">${esc(approvalStateLabel(user))}</span></div>
            <div class="user-status-line"><span class="user-status-key">Requested</span><span class="user-status-meta">${esc(fmtDate(user.signupSubmittedAtMs || user.createdAtMs || Date.now()))}</span></div>
            <div class="user-status-line"><span class="user-status-key">Roles</span><span class="user-status-meta">${esc(roleSummary(user, protectedUser))}</span></div>
            <div class="user-status-line"><span class="user-status-key">Password</span><span class="user-status-meta">${esc(user.mustChangePassword ? 'Temporary password active' : 'Normal sign-in')}</span></div>
            <div class="user-status-line"><span class="user-status-key">Rules</span><span class="user-status-meta">${esc(formatRulesStatus(user))}</span></div>
            <div class="user-status-line"><span class="user-status-key">Flags</span><span class="user-status-meta">${esc(flagSummary(user, dup))}</span></div>
          </div>
        </td>
        <td>
          <div class="rowBtns compact-rowBtns">${actions}</div>
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('[data-role]').forEach((btn) => btn.onclick = async () => {
    if (!canManageUsers()) return;
    const user = userRowsData.find((x) => x.id === btn.dataset.id);
    if (!user) return;

    const role = btn.dataset.role;
    const protectedUser = isProtectedCoreAdmin(user.email);
    if (protectedUser && ['removeMod', 'removeAdmin', 'banUser', 'denyAccess', 'deleteDuplicate', 'softDeleteAccount', 'hardDeleteAccount'].includes(role)) {
      alert('This core admin account cannot be modified.');
      return;
    }

    const ref = doc(db, 'profiles', user.id);

    if (role === 'grantMod') await updateDoc(ref, { isModerator: true, updatedAt: Date.now() });
    if (role === 'removeMod') await updateDoc(ref, { isModerator: false, updatedAt: Date.now() });
    if (role === 'grantAdmin') await updateDoc(ref, { isAdmin: true, ...approvalPatch() });
    if (role === 'removeAdmin') await updateDoc(ref, { isAdmin: false, updatedAt: Date.now() });
    if (role === 'approveAccess') await updateDoc(ref, approvalPatch());
    if (role === 'denyAccess') {
      const denyPayload = { accessApproved: false, accessManuallyDenied: true, approvalStatus: 'DENIED', pendingApprovalAtMs: Date.now(), updatedAt: Date.now() };
      if (!user.emailVerified) denyPayload.manualVerified = false;
      await updateDoc(ref, denyPayload);
    }
    if (role === 'banUser') await updateDoc(ref, { banned: true, updatedAt: Date.now() });
    if (role === 'unbanUser') await updateDoc(ref, { banned: false, deleted: false, approvalStatus: user.accessApproved ? 'APPROVED' : 'PENDING_ADMIN_APPROVAL', updatedAt: Date.now() });
    if (role === 'resetRules') {
      if (!confirm(`Reset rules agreement for ${user.email || 'this user'}? They will be forced to accept the current rules again on next login.`)) return;
      await updateDoc(ref, {
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
        updatedAt: Date.now()
      });
      return;
    }
    if (role === 'setTempPassword') {
      const suggested = generateTempPassword();
      const temporaryPassword = window.prompt(`Set a temporary password for ${user.email}. Share it with the user and they will be forced to change it after login.`, suggested);
      if (temporaryPassword === null) return;
      if (String(temporaryPassword).trim().length < 8) {
        alert('Temporary password must be at least 8 characters.');
        return;
      }
      try {
        const result = await callSetMarketplaceTempPassword(user, String(temporaryPassword).trim());
        const copied = await copyText(String(temporaryPassword).trim());
        alert(`${result?.message || 'Temporary password saved.'}${result?.note ? ` ${result.note}` : ''}${copied ? ' The password was also copied to your clipboard.' : ''}${user.accessApproved ? '' : ' This account still needs manual approval before the user can log in.'}`);
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (role === 'softDeleteAccount') {
      const selfRow = isSelfRow(user);
      if (!confirm(`Are you sure you want to delete ${user.email || 'this account'}? They will be moved to the Deleted Accounts list.`)) return;
      await updateDoc(ref, {
        deleted: true,
        accessApproved: false,
        approvalStatus: 'DELETED',
        banned: true,
        updatedAt: Date.now()
      });
      alert('Account moved to Deleted Accounts.');
      if (selfRow) {
        await signOut(auth).catch(() => {});
        window.location.href = 'index.html';
      }
      return;
    }
    if (role === 'hardDeleteAccount') {
      try {
        const selfRow = isSelfRow(user);
        const confirmWord = window.prompt(`Type DELETE to permanently remove ${user.email || 'this account'}. This deletes the Auth user, profile, and listings.${selfRow ? ' You are deleting your own account.' : ''}`, '');
        if (confirmWord !== 'DELETE') return;
        const result = await callDeleteMarketplaceAccount(user);
        alert(result?.message || 'Account permanently deleted.');
        if (selfRow) {
          await signOut(auth).catch(() => {});
          window.location.href = 'index.html';
        }
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (role === 'deleteDuplicate') {
      if (!confirm(`Delete duplicate profile row for ${user.email}? This removes only the extra profile document.`)) return;
      await deleteDoc(ref);
    }
  });
}

function startUsers() {
  onSnapshot(collection(db, 'profiles'), (snap) => {
    const rows = snap.docs.map((d) => ({ id:d.id, ...d.data() }));
    userRowsData = rows;
    renderUserRows();
  });
}


function ensureModerationModal() {
  if (document.getElementById('moderationOverlay')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="overlay" id="moderationOverlay" style="display:none">
    <div class="modal wide modal-scroll">
      <div class="modal-h sticky-head">
        <strong id="moderationThreadTitle">Thread Moderation</strong>
        <button class="btn ghost" id="moderationClose" type="button">Close</button>
      </div>
      <div class="modal-b">
        <div id="moderationThreadMeta" class="meta"></div>
        <div id="moderationThreadSummary" class="mod-stat-stack" style="margin:12px 0 16px"></div>
        <div id="moderationReplyList" class="replyModerationList"></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
  document.getElementById('moderationClose')?.addEventListener('click', closeModerationModal);
  document.getElementById('moderationOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'moderationOverlay') closeModerationModal();
  });
}

function openModerationModal(listingId) {
  if (!listingId) return;
  ensureModerationModal();
  moderationListingId = listingId;
  renderModerationModal();
  const overlay = document.getElementById('moderationOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeModerationModal() {
  moderationListingId = null;
  const overlay = document.getElementById('moderationOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function deleteReplyRecord(reply) {
  if (!reply) return;
  const listingId = reply.listingId || moderationListingId || '';
  if (!listingId) return;
  const listingRef = doc(db, 'listings', listingId);

  if (reply.source === 'legacy') {
    const listingSnap = await getDoc(listingRef);
    if (!listingSnap.exists()) return;
    const listingData = listingSnap.data() || {};
    const replies = Array.isArray(listingData.replies) ? listingData.replies.slice() : [];
    if (reply.legacyIndex < 0 || reply.legacyIndex >= replies.length) return;
    replies.splice(reply.legacyIndex, 1);
    await updateDoc(listingRef, { replies, updatedAt: Date.now() });
    await refreshListingReplySummary(listingId);
  } else if (reply.path) {
    await deleteFlagDocsForListing(listingId, reply.id).catch(() => {});
    await deleteDoc(doc(db, reply.path)).catch(() => {});
    await refreshListingReplySummary(listingId);
  }
}

function renderModerationModal() {
  const titleEl = $('moderationThreadTitle');
  const metaEl = $('moderationThreadMeta');
  const summaryEl = $('moderationThreadSummary');
  const listEl = $('moderationReplyList');
  if (!titleEl || !metaEl || !summaryEl || !listEl) return;
  if (!moderationListingId) {
    titleEl.textContent = 'Thread Moderation';
    metaEl.textContent = '';
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<div class="note">Select a thread to moderate.</div>';
    return;
  }

  const listing = listingRowsData.find((item) => item.id === moderationListingId);
  if (!listing) {
    titleEl.textContent = 'Thread no longer exists';
    metaEl.textContent = '';
    summaryEl.innerHTML = '';
    listEl.innerHTML = '<div class="note">This post was already removed.</div>';
    return;
  }

  const replies = mergedRepliesForListing(listing);
  const openFlags = getOpenFlagsForListing(listing.id);
  const visibleReplyCount = replies.filter((reply) => reply.deleted !== true).length;
  titleEl.textContent = listing.title || 'Thread Moderation';
  metaEl.textContent = `${boardLabels[listing.board || listing.category || 'BUYSELL'] || (listing.board || listing.category || 'BUYSELL')} • ${listing.displayName || listing.userEmail || 'Unknown poster'} • ${fmtDate(listing.createdAtMs)}`;
  summaryEl.innerHTML = `
    <div class="mod-stat-line">
      <span class="mod-chip ${visibleReplyCount ? 'good' : ''}">${visibleReplyCount} active repl${visibleReplyCount === 1 ? 'y' : 'ies'}</span>
      <span class="mod-chip ${openFlags.length || listing.moderationFlagged ? 'flagged' : ''}">${openFlags.length + (listing.moderationFlagged ? 1 : 0)} open flag${(openFlags.length + (listing.moderationFlagged ? 1 : 0)) === 1 ? '' : 's'}</span>
      ${listing.moderationFlagged ? '<span class="mod-chip bad">Post flagged</span>' : ''}
      <span class="mod-chip">Status ${esc(listing.status || 'ACTIVE')}</span>
    </div>`;

  if (!replies.length) {
    listEl.innerHTML = '<div class="note">No replies have been posted in this thread yet.</div>';
    return;
  }

  listEl.innerHTML = replies.map((reply) => {
    const badges = [];
    if (reply.flagged) badges.push('<span class="mod-chip flagged">Flagged</span>');
    if (reply.source === 'legacy') badges.push('<span class="mod-chip">Legacy</span>');
    if (reply.deleted) badges.push('<span class="mod-chip bad">Removed</span>');
    if (reply.hidden && !reply.deleted) badges.push('<span class="mod-chip">Hidden</span>');
    const reasonText = Array.isArray(reply.moderationLabels) && reply.moderationLabels.length ? reply.moderationLabels.join(' • ') : '—';
    const bodyText = reply.deleted ? 'Reply removed by moderation.' : (reply.hidden ? 'Reply hidden by moderation.' : (reply.text || ''));
    return `
      <div class="replyModerationCard ${reply.flagged ? 'flagged' : ''} ${reply.deleted ? 'deleted' : ''}">
        <div class="replyModerationHead">
          <div class="replyModerationMeta">
            <div class="replyModerationAuthor">${esc(reply.displayName || reply.userEmail || 'Unknown')}</div>
            <div class="replyModerationSub">${esc(reply.userEmail || '—')} • ${esc(fmtDate(reply.createdAtMs || Date.now()))}</div>
            ${badges.length ? `<div class="mod-stat-line">${badges.join('')}</div>` : ''}
          </div>
          <div class="replyModerationMeta" style="justify-items:end">
            <div class="replyModerationSub">Detected</div>
            <div class="moderation-content">${esc(reasonText)}</div>
          </div>
        </div>
        <div class="replyModerationText">${esc(bodyText)}</div>
        <div class="rowBtns compact-rowBtns" style="margin-top:12px">
          ${!reply.deleted ? `<button class="btn danger" data-reply-delete="${esc(reply.source)}" data-reply-id="${esc(reply.id || '')}" data-reply-listing="${esc(reply.listingId)}" data-reply-legacy-index="${String(reply.legacyIndex ?? '')}" type="button">Delete Reply</button>` : '<span class="pill">Already removed</span>'}
          ${reply.flagged ? `<button class="btn ghost" data-reply-resolve="${esc(reply.sourceKey)}" type="button">Mark Reviewed</button>` : ''}
        </div>
      </div>`;
  }).join('');

  document.querySelectorAll('[data-reply-delete]').forEach((btn) => btn.onclick = async () => {
    const listingId = btn.dataset.replyListing;
    const repliesForListing = mergedRepliesForListing(listingRowsData.find((item) => item.id === listingId));
    const reply = btn.dataset.replyDelete === 'legacy'
      ? repliesForListing.find((item) => item.source === 'legacy' && String(item.legacyIndex) === String(btn.dataset.replyLegacyIndex))
      : repliesForListing.find((item) => item.source === 'doc' && item.id === btn.dataset.replyId);
    if (!reply) return;
    if (!confirm('Delete this reply from employee view?')) return;
    await deleteReplyRecord(reply);
  });
  document.querySelectorAll('[data-reply-resolve]').forEach((btn) => btn.onclick = async () => {
    await resolveFlagsForSource(btn.dataset.replyResolve, 'reviewed');
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
          <div class="field"><label>Board</label><select id="adminEditBoard"><option value="FREE">Free Items</option><option value="BUYSELL">Buy / Sell</option><option value="GARAGE">Garage Sales</option><option value="EVENTS">Events</option><option value="WORK">Work News</option><option value="PICTURES">Pictures</option><option value="SERVICES">Local Services</option></select></div>
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

// --- CUSTOM WOW-FACTOR HERO SLIDER COMPONENT ---
class HeroSlider extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.images = JSON.parse(this.getAttribute('images') || '[]');
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
        will-change: transform, opacity;
      }
      
      .slide.active {
        opacity: 1;
        transform: scale(1.05); /* Smooth Ken Burns zoom effect */
        z-index: 2;
      }
      
      .noise-overlay {
        position: absolute;
        inset: 0;
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
