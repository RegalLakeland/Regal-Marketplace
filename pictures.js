import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const PAGE_ID = 'pictures-home';
const EXTRA_EDITOR_EMAILS = ['ariel.r@regallakeland.com'];
const LOCAL_DRAFT_KEY = 'regal_pictures_designer_local_draft_v1';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function safeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
  const num = safeNumber(value, fallback);
  return Math.max(min, Math.min(max, num));
}

const DEFAULT_STATE = {
  title: 'Regal Photography',
  canvasWidth: 1800,
  canvasHeight: 2600,
  background: '#0b111b',
  defaultShadows: true,
  elements: [
    {
      id: crypto.randomUUID(),
      type: 'text',
      x: 6,
      y: 4,
      w: 52,
      h: 8,
      z: 1,
      text: 'Regal Photography',
      fontFamily: 'Inter, sans-serif',
      fontSize: 54,
      fontWeight: 800,
      color: '#ffffff',
      background: 'transparent',
      textAlign: 'left'
    },
    {
      id: crypto.randomUUID(),
      type: 'text',
      x: 6,
      y: 12,
      w: 58,
      h: 6,
      z: 2,
      text: 'Use the studio to drop images anywhere on the page, resize them from every side, and add captions or text blocks anywhere you want.',
      fontFamily: 'Inter, sans-serif',
      fontSize: 22,
      fontWeight: 500,
      color: '#d5dfec',
      background: 'transparent',
      textAlign: 'left'
    }
  ]
};

let currentUser = null;
let currentProfile = null;
let remoteUpdatedAtMs = 0;
let pageState = structuredClone(DEFAULT_STATE);
let selectedId = '';
let editorMode = false;
let toolsHidden = false;
let dirty = false;
let saveInFlight = false;
let snapEnabled = true;
let zoomPercent = 100;
let unsubPage = null;
let interaction = null;
let statusTimeout = null;
let uploadInFlight = false;
let pageOwnerUid = '';
let pageOwnerEmail = '';


function hideStatus() {
  const banner = $('statusBanner');
  if (!banner) return;
  banner.classList.add('hidden');
}

function showStatus() {
  const banner = $('statusBanner');
  if (!banner) return;
  banner.classList.remove('hidden');
}

function status(message, sticky = false) {
  const banner = $('statusBanner');
  if (!banner) return;
  banner.textContent = message;
  showStatus();
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
  if (!sticky) {
    statusTimeout = setTimeout(() => {
      if (editorMode) {
        banner.textContent = 'Studio ready.';
        showStatus();
      } else {
        hideStatus();
      }
    }, 2400);
  }
}

function pageRef() {
  return doc(db, 'listings', PAGE_ID);
}

function isEditor() {
  const email = normalizeEmail(currentUser?.email);
  return !!currentUser && !!currentProfile && (
    !!currentProfile.isAdmin ||
    !!currentProfile.isModerator ||
    ADMIN_EMAILS.map(normalizeEmail).includes(email) ||
    EXTRA_EDITOR_EMAILS.includes(email)
  );
}

function isPrivilegedEditor() {
  const email = normalizeEmail(currentUser?.email);
  return !!currentUser && !!currentProfile && (
    !!currentProfile.isAdmin ||
    !!currentProfile.isModerator ||
    ADMIN_EMAILS.map(normalizeEmail).includes(email)
  );
}

function canSavePage() {
  if (!isEditor()) return false;
  if (!pageOwnerUid) return true;
  return isPrivilegedEditor() || pageOwnerUid === currentUser?.uid;
}

function selectedElement() {
  return pageState.elements.find((element) => element.id === selectedId) || null;
}

function markDirty(message = 'Unsaved changes') {
  dirty = true;
  persistLocalDraft();
  status(message, true);
}

function persistLocalDraft() {
  try {
    localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data: pageState }));
  } catch (_) {}
}

function maybeRestoreLocalDraft(remoteState) {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return remoteState;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return remoteState;
    if ((parsed.savedAt || 0) > (remoteUpdatedAtMs || 0)) {
      return parsed.data;
    }
  } catch (_) {}
  return remoteState;
}

function sanitizeState(data) {
  const base = structuredClone(DEFAULT_STATE);
  const rawWidth = safeNumber(data?.canvasWidth, base.canvasWidth);
  const rawHeight = safeNumber(data?.canvasHeight, base.canvasHeight);
  const state = {
    ...base,
    ...data,
    canvasWidth: clampNumber(rawWidth, 1400, 2600, base.canvasWidth),
    canvasHeight: clampNumber(rawHeight, 1200, 10000, base.canvasHeight),
    background: String(data?.background || base.background),
    defaultShadows: data?.defaultShadows !== false,
    elements: Array.isArray(data?.elements) ? data.elements.map(sanitizeElement).filter(Boolean) : base.elements
  };
  return state;
}


function sanitizeElement(raw) {
  if (!raw || !raw.type) return null;
  const common = {
    id: String(raw.id || crypto.randomUUID()),
    type: raw.type === 'image' ? 'image' : 'text',
    x: clampNumber(raw.x ?? 10, 0, 96, 10),
    y: clampNumber(raw.y ?? 10, 0, 96, 10),
    w: clampNumber(raw.w ?? 20, 4, 100, 20),
    h: clampNumber(raw.h ?? 12, 4, 100, 12),
    z: safeNumber(raw.z, 1)
  };
  if (common.type === 'image') {
    return {
      ...common,
      src: String(raw.src || ''),
      caption: String(raw.caption || ''),
      fit: raw.fit === 'contain' ? 'contain' : 'cover',
      radius: clampNumber(raw.radius ?? 18, 0, 80, 18),
      shadow: raw.shadow !== false
    };
  }
  return {
    ...common,
    text: String(raw.text || 'New text'),
    fontFamily: String(raw.fontFamily || 'Inter, sans-serif'),
    fontSize: clampNumber(raw.fontSize ?? 24, 12, 160, 24),
    fontWeight: String(raw.fontWeight || 600),
    color: String(raw.color || '#ffffff'),
    background: String(raw.background || 'transparent'),
    textAlign: ['left', 'center', 'right'].includes(raw.textAlign) ? raw.textAlign : 'left'
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snap(value) {
  return snapEnabled ? Math.round(value * 2) / 2 : value;
}

function render() {
  document.title = `${pageState.title || 'Pictures'} - Regal Lakeland`;
  document.body.classList.toggle('editor-open', editorMode);
  document.body.classList.toggle('viewer-open', !editorMode);
  renderHeader();
  renderCanvas();
  renderLayers();
  renderSelection();
  applyPageFrame();
}

function renderHeader() {
  $('picturesUserPill').textContent = currentUser ? (currentProfile?.displayName || currentUser.email || 'Signed in') : 'Sign in required';
  $('toggleStudioBtn').style.display = isEditor() ? 'inline-flex' : 'none';
  $('savePageBtn').style.display = editorMode && isEditor() ? 'inline-flex' : 'none';
  $('toggleStudioBtn').textContent = editorMode ? 'Close Studio' : 'Open Studio';
  $('designerSidebar').style.display = editorMode && !toolsHidden ? 'block' : 'none';
  $('showToolsBtn').style.display = editorMode && toolsHidden ? 'inline-flex' : 'none';
  $('pageTitleInput').value = pageState.title || '';
  $('canvasHeightInput').value = String(pageState.canvasHeight || 2600);
  $('canvasWidthInput').value = String(pageState.canvasWidth || 1800);
  $('pageBgInput').value = normalizeHexColor(pageState.background, '#0b111b');
  $('snapToggle').checked = snapEnabled;
  $('shadowToggle').checked = pageState.defaultShadows !== false;
  $('zoomSelect').value = String(zoomPercent);
  if (!editorMode && $('statusBanner')?.textContent === 'Gallery ready.') hideStatus();
}

function normalizeHexColor(value, fallback) {
  const clean = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function applyPageFrame() {
  const frame = $('pageFrame');
  const canvas = $('pageCanvas');
  const stageShell = $('stageShell');
  const stageScroll = $('stageScroll');
  if (!frame || !canvas) return;
  const width = clampNumber(pageState.canvasWidth, 1400, 2600, 1800);
  const height = clampNumber(pageState.canvasHeight, 1200, 10000, 2200);
  frame.style.setProperty('--canvas-max-width', `${width}px`);
  frame.style.setProperty('--canvas-zoom', String(editorMode ? (zoomPercent / 100) : 1));
  canvas.style.setProperty('--canvas-aspect', `${width} / ${height}`);
  canvas.style.setProperty('--canvas-bg', pageState.background || '#0b111b');
  canvas.classList.toggle('editor-mode', editorMode);
  canvas.classList.toggle('viewer-mode', !editorMode);
  if (stageShell) stageShell.classList.toggle('viewer-shell', !editorMode);
  if (stageScroll) stageScroll.classList.toggle('viewer-scroll', !editorMode);
}


function renderCanvas() {
  const canvas = $('pageCanvas');
  if (!canvas) return;

  if (!currentUser) {
    canvas.innerHTML = `
      <div class="viewer-empty">
        <div class="login-needed">
          <h2>Sign in required</h2>
          <p>Pictures is part of the private marketplace. Sign in to the marketplace first, then open the Pictures page again.</p>
          <a class="topbar-btn primary" href="index.html">Go to Login</a>
        </div>
      </div>`;
    return;
  }

  const elements = [...pageState.elements].sort((a, b) => a.z - b.z);
  if (!elements.length) {
    canvas.innerHTML = `
      <div class="viewer-empty">
        <div>
          <h2>${esc(pageState.title || 'Pictures')}</h2>
          <p>${editorMode ? 'Use Add Photos or double-click the canvas to start designing.' : 'No images have been published yet.'}</p>
        </div>
      </div>`;
    return;
  }

  canvas.innerHTML = elements.map((element) => {
    const isSelected = element.id === selectedId;
    const style = `left:${element.x}%;top:${element.y}%;width:${element.w}%;height:${element.h}%;z-index:${element.z};`;
    if (element.type === 'image') {
      return `
        <div class="designer-element image-element ${isSelected ? 'selected' : ''}" data-id="${esc(element.id)}" data-type="image" style="${style}">
          ${editorMode ? `<button class="drag-chip" type="button" data-drag-id="${esc(element.id)}">Move</button>` : ''}
          <div class="designer-image-wrap" data-select-id="${esc(element.id)}">
            <img class="designer-image" src="${esc(element.src)}" alt="${esc(element.caption || pageState.title || 'Gallery image')}" style="object-fit:${esc(element.fit || 'cover')};border-radius:${Number(element.radius || 0)}px;${(element.shadow ?? pageState.defaultShadows) ? 'box-shadow:0 18px 44px rgba(0,0,0,.28);' : ''}" />
            ${element.caption ? `<div class="designer-caption">${esc(element.caption)}</div>` : ''}
          </div>
          ${editorMode && isSelected ? resizeHandlesHtml() : ''}
        </div>`;
    }
    return `
      <div class="designer-element text-element ${isSelected ? 'selected' : ''}" data-id="${esc(element.id)}" data-type="text" style="${style}">
        ${editorMode ? `<button class="drag-chip" type="button" data-drag-id="${esc(element.id)}">Move</button>` : ''}
        <div class="designer-text" data-text-id="${esc(element.id)}" ${editorMode ? 'contenteditable="true" spellcheck="true"' : ''} style="font-family:${esc(element.fontFamily)};font-size:${Number(element.fontSize || 24)}px;font-weight:${esc(element.fontWeight || 600)};color:${esc(element.color || '#ffffff')};background:${esc(element.background || 'transparent')};text-align:${esc(element.textAlign || 'left')};">${esc(element.text || '')}</div>
        ${editorMode && isSelected ? resizeHandlesHtml() : ''}
      </div>`;
  }).join('');
}

function resizeHandlesHtml() {
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((dir) => `<div class="resize-handle ${dir}" data-resize="${dir}"></div>`).join('');
}

function renderLayers() {
  const wrap = $('layersList');
  if (!wrap) return;
  const elements = [...pageState.elements].sort((a, b) => b.z - a.z);
  wrap.innerHTML = elements.map((element) => `
    <button class="layer-btn ${element.id === selectedId ? 'active' : ''}" type="button" data-layer-id="${esc(element.id)}">
      <span>
        <span class="layer-type">${esc(element.type)}</span><br />
        ${esc(element.type === 'image' ? (element.caption || 'Image') : ((element.text || 'Text').slice(0, 42) || 'Text'))}
      </span>
      <span>#${element.z}</span>
    </button>`).join('') || '<div class="empty-mini">No blocks yet.</div>';
}

function renderSelection() {
  const element = selectedElement();
  $('selectionEmpty').style.display = element ? 'none' : 'block';
  $('selectionControls').style.display = element ? 'block' : 'none';
  $('imageControls').style.display = element?.type === 'image' ? 'block' : 'none';
  $('textControls').style.display = element?.type === 'text' ? 'block' : 'none';
  if (!element) return;

  $('selX').value = element.x.toFixed(1);
  $('selY').value = element.y.toFixed(1);
  $('selW').value = element.w.toFixed(1);
  $('selH').value = element.h.toFixed(1);

  if (element.type === 'image') {
    $('imageCaptionInput').value = element.caption || '';
    $('imageFitInput').value = element.fit || 'cover';
    $('imageRadiusInput').value = String(element.radius || 0);
  } else {
    $('textContentInput').value = element.text || '';
    $('textFontInput').value = element.fontFamily || 'Inter, sans-serif';
    $('textSizeInput').value = String(element.fontSize || 24);
    $('textWeightInput').value = String(element.fontWeight || 600);
    $('textAlignInput').value = element.textAlign || 'left';
    $('textColorInput').value = normalizeHexColor(element.color, '#ffffff');
    $('textBgInput').value = normalizeHexColor(element.background, '#000000');
  }
}

function setSelected(id) {
  selectedId = id || '';
  render();
}

function updateSelected(mutator, message = 'Block updated') {
  const element = selectedElement();
  if (!element) return;
  mutator(element);
  normalizeElementBounds(element);
  markDirty(message);
  render();
}

function normalizeElementBounds(element) {
  element.w = clamp(Number(element.w || 0), 4, 100);
  element.h = clamp(Number(element.h || 0), 4, 100);
  element.x = clamp(Number(element.x || 0), 0, 100 - element.w);
  element.y = clamp(Number(element.y || 0), 0, 100 - element.h);
}

function pageDocToState(data) {
  pageOwnerUid = String(data?.uid || '');
  pageOwnerEmail = normalizeEmail(data?.userEmail || data?.createdByEmail || '');
  remoteUpdatedAtMs = Number(data?.updatedAtMs || 0);
  const layout = data?.layoutState || data?.pageState || data?.layout || DEFAULT_STATE;
  return sanitizeState(maybeRestoreLocalDraft(layout));
}

function buildLayoutPayload() {
  const ownerUid = pageOwnerUid || currentUser?.uid || '';
  const ownerEmail = pageOwnerEmail || normalizeEmail(currentUser?.email || '');
  const firstImage = pageState.elements.find((element) => element.type === 'image' && element.src);
  const imageUrls = pageState.elements.filter((element) => element.type === 'image' && element.src).map((element) => element.src).slice(0, 12);
  return {
    uid: ownerUid,
    userEmail: ownerEmail,
    displayName: currentProfile?.displayName || currentUser?.displayName || currentUser?.email || 'Pictures Studio',
    board: 'PICTURES',
    title: 'Pictures Home',
    description: 'Standalone photography layout',
    location: 'Regal gallery',
    status: 'ACTIVE',
    hidden: true,
    deleted: false,
    standaloneGallery: true,
    layoutType: 'STANDALONE_PAGE',
    imageUrl: firstImage?.src || '',
    imageUrls,
    layoutState: pageState,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
    updatedByUid: currentUser?.uid || '',
    updatedByEmail: normalizeEmail(currentUser?.email || ''),
    createdAt: serverTimestamp(),
    createdAtMs: remoteUpdatedAtMs || Date.now(),
    createdByEmail: ownerEmail
  };
}

function startPageListener() {
  if (unsubPage) unsubPage();
  unsubPage = onSnapshot(pageRef(), (snap) => {
    if (!snap.exists()) {
      pageOwnerUid = '';
      pageOwnerEmail = '';
      if (!dirty) {
        pageState = sanitizeState(maybeRestoreLocalDraft(DEFAULT_STATE));
      }
      if (!pageState.elements.some((element) => element.id === selectedId)) {
        selectedId = pageState.elements[0]?.id || '';
      }
      render();
      status(editorMode ? 'Studio ready. Save once to publish this page.' : 'No gallery published yet.', true);
      return;
    }
    const data = snap.data() || {};
    if (editorMode && dirty) return;
    pageState = pageDocToState(data);
    if (!pageState.elements.some((element) => element.id === selectedId)) {
      selectedId = pageState.elements[0]?.id || '';
    }
    render();
    if (editorMode) status('Studio ready.'); else hideStatus();
  }, (error) => {
    console.error(error);
    status(`Load error: ${error.message || error}`, true);
  });
}

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid));
  currentProfile = snap.exists() ? snap.data() : null;
}

function syncStudioUrl(open) {
  try {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set('edit', '1');
    else url.searchParams.delete('edit');
    history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
  } catch (_) {}
}

async function savePage() {
  if (!isEditor() || saveInFlight) return;
  if (!canSavePage()) {
    status('This shared page is owned by another account. Have an admin make Ariel a moderator or transfer ownership once.', true);
    return;
  }
  saveInFlight = true;
  $('savePageBtn').disabled = true;
  try {
    const payload = buildLayoutPayload();
    await setDoc(pageRef(), payload, { merge: true });
    pageOwnerUid = payload.uid;
    pageOwnerEmail = payload.userEmail;
    dirty = false;
    remoteUpdatedAtMs = payload.updatedAtMs;
    localStorage.removeItem(LOCAL_DRAFT_KEY);
    editorMode = false;
    toolsHidden = false;
    selectedId = '';
    syncStudioUrl(false);
    render();
    const stage = $('stageScroll');
    if (stage) stage.scrollTo({ top: 0, behavior: 'smooth' });
    status('Gallery saved. Opening published view...');
  } catch (error) {
    console.error(error);
    status(`Save failed: ${error.message || error}`, true);
  } finally {
    saveInFlight = false;
    $('savePageBtn').disabled = false;
  }
}

function createTextBlock(heading = false, x = 8, y = 18) {
  const block = sanitizeElement({
    id: crypto.randomUUID(),
    type: 'text',
    x,
    y,
    w: heading ? 48 : 34,
    h: heading ? 8 : 10,
    z: nextZ(),
    text: heading ? 'New Heading' : 'New text block',
    fontFamily: 'Inter, sans-serif',
    fontSize: heading ? 44 : 24,
    fontWeight: heading ? 800 : 500,
    color: '#ffffff',
    background: 'transparent',
    textAlign: 'left'
  });
  pageState.elements.push(block);
  setSelected(block.id);
  markDirty(heading ? 'Heading added' : 'Text block added');
}

function nextZ() {
  return (pageState.elements.reduce((max, element) => Math.max(max, Number(element.z || 0)), 0) || 0) + 1;
}

function duplicateSelected() {
  const element = selectedElement();
  if (!element) return;
  const copy = sanitizeElement({
    ...structuredClone(element),
    id: crypto.randomUUID(),
    x: clamp(element.x + 2, 0, 100 - element.w),
    y: clamp(element.y + 2, 0, 100 - element.h),
    z: nextZ()
  });
  pageState.elements.push(copy);
  setSelected(copy.id);
  markDirty('Block duplicated');
}

function deleteSelected() {
  if (!selectedId) return;
  pageState.elements = pageState.elements.filter((element) => element.id !== selectedId);
  selectedId = pageState.elements[0]?.id || '';
  markDirty('Block removed');
  render();
}

function alignSelected(where) {
  updateSelected((element) => {
    if (where === 'left') element.x = 0;
    if (where === 'center') element.x = (100 - element.w) / 2;
    if (where === 'right') element.x = 100 - element.w;
    if (where === 'top') element.y = 0;
    if (where === 'middle') element.y = (100 - element.h) / 2;
    if (where === 'bottom') element.y = 100 - element.h;
  }, 'Block aligned');
}

async function uploadAndPlaceImages(files) {
  if (!isEditor() || !files.length || uploadInFlight) return;
  uploadInFlight = true;
  status(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`, true);
  try {
    const urls = [];
    for (const [index, file] of files.entries()) {
      const safeName = `${Date.now()}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storageRef = ref(storage, `images/${currentUser.uid}/${safeName}`);
      await uploadBytes(storageRef, file);
      urls.push(await getDownloadURL(storageRef));
    }
    placeNewImages(urls);
    markDirty(`${urls.length} image${urls.length === 1 ? '' : 's'} added`);
    render();
  } catch (error) {
    console.error(error);
    status(`Upload failed: ${error.message || error}`, true);
  } finally {
    uploadInFlight = false;
    $('designerUploadInput').value = '';
  }
}

function placeNewImages(urls) {
  const cols = urls.length >= 4 ? 3 : Math.min(2, urls.length);
  const width = cols === 3 ? 28 : 42;
  const gap = 3;
  let startY = 22;
  if (pageState.elements.length) {
    startY = Math.min(88, Math.max(...pageState.elements.map((element) => element.y + element.h)) + 2);
  }
  urls.forEach((url, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const block = sanitizeElement({
      id: crypto.randomUUID(),
      type: 'image',
      x: 6 + col * (width + gap),
      y: startY + row * 24,
      w: width,
      h: 20,
      z: nextZ() + index,
      src: url,
      caption: '',
      fit: 'cover',
      radius: 18,
      shadow: pageState.defaultShadows !== false
    });
    pageState.elements.push(block);
    selectedId = block.id;
  });
}

function pointerDownMove(event, elementId) {
  if (!editorMode) return;
  const canvasRect = $('pageCanvas').getBoundingClientRect();
  const element = pageState.elements.find((entry) => entry.id === elementId);
  if (!element) return;
  interaction = {
    mode: 'move',
    id: elementId,
    startX: event.clientX,
    startY: event.clientY,
    originX: element.x,
    originY: element.y,
    rect: canvasRect
  };
  setSelected(elementId);
}

function pointerDownResize(event, elementId, dir) {
  if (!editorMode) return;
  const canvasRect = $('pageCanvas').getBoundingClientRect();
  const element = pageState.elements.find((entry) => entry.id === elementId);
  if (!element) return;
  interaction = {
    mode: 'resize',
    dir,
    id: elementId,
    startX: event.clientX,
    startY: event.clientY,
    origin: { x: element.x, y: element.y, w: element.w, h: element.h },
    rect: canvasRect
  };
  setSelected(elementId);
}

function handlePointerMove(event) {
  if (!interaction) return;
  const element = pageState.elements.find((entry) => entry.id === interaction.id);
  if (!element) return;
  const dxPct = ((event.clientX - interaction.startX) / interaction.rect.width) * 100;
  const dyPct = ((event.clientY - interaction.startY) / interaction.rect.height) * 100;

  if (interaction.mode === 'move') {
    element.x = snap(clamp(interaction.originX + dxPct, 0, 100 - element.w));
    element.y = snap(clamp(interaction.originY + dyPct, 0, 100 - element.h));
  } else if (interaction.mode === 'resize') {
    const next = { ...interaction.origin };
    if (interaction.dir.includes('e')) next.w = interaction.origin.w + dxPct;
    if (interaction.dir.includes('s')) next.h = interaction.origin.h + dyPct;
    if (interaction.dir.includes('w')) {
      next.x = interaction.origin.x + dxPct;
      next.w = interaction.origin.w - dxPct;
    }
    if (interaction.dir.includes('n')) {
      next.y = interaction.origin.y + dyPct;
      next.h = interaction.origin.h - dyPct;
    }
    next.w = clamp(next.w, 4, 100);
    next.h = clamp(next.h, 4, 100);
    next.x = clamp(next.x, 0, 100 - next.w);
    next.y = clamp(next.y, 0, 100 - next.h);
    element.x = snap(next.x);
    element.y = snap(next.y);
    element.w = snap(next.w);
    element.h = snap(next.h);
  }

  render();
}

function handlePointerUp() {
  if (!interaction) return;
  interaction = null;
  markDirty('Layout updated');
  render();
}

function bindEvents() {
  $('toggleStudioBtn').addEventListener('click', () => {
    if (!isEditor()) return;
    editorMode = !editorMode;
    toolsHidden = false;
    syncStudioUrl(editorMode);
    if (editorMode) status('Studio ready.'); else hideStatus();
    render();
    const stage = $('stageScroll');
    if (stage) stage.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('savePageBtn').addEventListener('click', savePage);
  $('addPhotosBtn').addEventListener('click', () => $('designerUploadInput').click());
  $('designerUploadInput').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    await uploadAndPlaceImages(files);
  });
  $('addHeadingBtn').addEventListener('click', () => createTextBlock(true));
  $('addTextBtn').addEventListener('click', () => createTextBlock(false));
  $('duplicateBlockBtn').addEventListener('click', duplicateSelected);
  $('deleteBlockBtn').addEventListener('click', deleteSelected);
  $('hideToolsBtn').addEventListener('click', () => {
    toolsHidden = true;
    renderHeader();
  });
  $('showToolsBtn').addEventListener('click', () => {
    toolsHidden = false;
    renderHeader();
  });

  $('pageTitleInput').addEventListener('input', (event) => {
    pageState.title = event.target.value;
    markDirty('Title updated');
  });
  $('canvasHeightInput').addEventListener('input', (event) => {
    pageState.canvasHeight = clamp(Number(event.target.value || 2600), 1200, 10000);
    markDirty('Canvas height updated');
    render();
  });
  $('canvasWidthInput').addEventListener('input', (event) => {
    pageState.canvasWidth = clamp(Number(event.target.value || 1800), 1200, 2600);
    markDirty('Canvas width updated');
    render();
  });
  $('pageBgInput').addEventListener('input', (event) => {
    pageState.background = event.target.value;
    markDirty('Background updated');
    render();
  });
  $('snapToggle').addEventListener('change', (event) => {
    snapEnabled = !!event.target.checked;
    status(snapEnabled ? 'Snap enabled.' : 'Snap disabled.');
  });
  $('shadowToggle').addEventListener('change', (event) => {
    pageState.defaultShadows = !!event.target.checked;
    markDirty('Default shadow setting updated');
    render();
  });
  $('zoomSelect').addEventListener('change', (event) => {
    zoomPercent = clamp(Number(event.target.value || 100), 60, 115);
    applyPageFrame();
  });

  ['selX', 'selY', 'selW', 'selH'].forEach((id) => {
    $(id).addEventListener('input', () => {
      updateSelected((element) => {
        element.x = Number($('selX').value || element.x);
        element.y = Number($('selY').value || element.y);
        element.w = Number($('selW').value || element.w);
        element.h = Number($('selH').value || element.h);
      });
    });
  });

  document.querySelectorAll('[data-align]').forEach((button) => {
    button.addEventListener('click', () => alignSelected(button.dataset.align));
  });

  $('imageCaptionInput').addEventListener('input', (event) => updateSelected((element) => { element.caption = event.target.value; }));
  $('imageFitInput').addEventListener('change', (event) => updateSelected((element) => { element.fit = event.target.value; }));
  $('imageRadiusInput').addEventListener('input', (event) => updateSelected((element) => { element.radius = clamp(Number(event.target.value || 0), 0, 80); }));

  $('textContentInput').addEventListener('input', (event) => updateSelected((element) => { element.text = event.target.value; }, 'Text updated'));
  $('textFontInput').addEventListener('change', (event) => updateSelected((element) => { element.fontFamily = event.target.value; }));
  $('textSizeInput').addEventListener('input', (event) => updateSelected((element) => { element.fontSize = clamp(Number(event.target.value || 24), 12, 160); }));
  $('textWeightInput').addEventListener('change', (event) => updateSelected((element) => { element.fontWeight = event.target.value; }));
  $('textAlignInput').addEventListener('change', (event) => updateSelected((element) => { element.textAlign = event.target.value; }));
  $('textColorInput').addEventListener('input', (event) => updateSelected((element) => { element.color = event.target.value; }));
  $('textBgInput').addEventListener('input', (event) => updateSelected((element) => { element.background = event.target.value; }));

  $('layersList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-layer-id]');
    if (!button) return;
    setSelected(button.dataset.layerId);
  });

  $('pageCanvas').addEventListener('click', (event) => {
    const element = event.target.closest('.designer-element');
    if (element) {
      setSelected(element.dataset.id);
      if (!editorMode && element.dataset.type === 'image') {
        const image = pageState.elements.find((entry) => entry.id === element.dataset.id);
        if (image?.src) openLightbox(image.src, image.caption || pageState.title || 'Gallery image');
      }
      return;
    }
    if (editorMode) setSelected('');
  });

  $('pageCanvas').addEventListener('dblclick', (event) => {
    if (!editorMode) return;
    if (event.target.closest('.designer-element')) return;
    const rect = $('pageCanvas').getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 2, 88);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 2, 92);
    createTextBlock(false, x, y);
  });

  $('pageCanvas').addEventListener('pointerdown', (event) => {
    const resizeHandle = event.target.closest('[data-resize]');
    if (resizeHandle) {
      const parent = resizeHandle.closest('.designer-element');
      if (!parent) return;
      event.preventDefault();
      pointerDownResize(event, parent.dataset.id, resizeHandle.dataset.resize);
      return;
    }
    const dragChip = event.target.closest('[data-drag-id]');
    if (dragChip) {
      event.preventDefault();
      pointerDownMove(event, dragChip.dataset.dragId);
      return;
    }
    const imageBlock = event.target.closest('.image-element');
    if (editorMode && imageBlock) {
      event.preventDefault();
      pointerDownMove(event, imageBlock.dataset.id);
    }
  });

  $('pageCanvas').addEventListener('input', (event) => {
    const textEl = event.target.closest('[data-text-id]');
    if (!textEl) return;
    const text = textEl.textContent || '';
    const element = pageState.elements.find((entry) => entry.id === textEl.dataset.textId);
    if (!element) return;
    element.text = text;
    markDirty('Text updated');
    $('textContentInput').value = text;
  });

  document.addEventListener('pointermove', handlePointerMove);
  document.addEventListener('pointerup', handlePointerUp);

  document.addEventListener('keydown', (event) => {
    if (!editorMode) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void savePage();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelected();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !event.target.closest('input, textarea, [contenteditable="true"]')) {
      event.preventDefault();
      deleteSelected();
      return;
    }
    const element = selectedElement();
    if (!element || event.target.closest('input, textarea, [contenteditable="true"]')) return;
    const step = event.shiftKey ? 1 : 0.25;
    if (event.key === 'ArrowLeft') { element.x = snap(clamp(element.x - step, 0, 100 - element.w)); markDirty('Block moved'); render(); }
    if (event.key === 'ArrowRight') { element.x = snap(clamp(element.x + step, 0, 100 - element.w)); markDirty('Block moved'); render(); }
    if (event.key === 'ArrowUp') { element.y = snap(clamp(element.y - step, 0, 100 - element.h)); markDirty('Block moved'); render(); }
    if (event.key === 'ArrowDown') { element.y = snap(clamp(element.y + step, 0, 100 - element.h)); markDirty('Block moved'); render(); }
    if (event.key === ']') { element.z = nextZ(); markDirty('Layer moved forward'); render(); }
  });

  $('lightboxClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (event) => {
    if (event.target === $('lightbox')) closeLightbox();
  });
}

function openLightbox(src, caption) {
  $('lightboxImage').src = src;
  $('lightboxCaption').textContent = caption || '';
  $('lightbox').style.display = 'grid';
}

function closeLightbox() {
  $('lightbox').style.display = 'none';
  $('lightboxImage').src = '';
}

async function boot() {
  bindEvents();
  status('Checking access…', true);
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentProfile = null;
    if (!user) {
      editorMode = false;
      pageState = structuredClone(DEFAULT_STATE);
      render();
      status('Sign in to the marketplace to view Pictures.', true);
      return;
    }

    await loadProfile(user.uid).catch((error) => {
      console.error(error);
      status(`Profile error: ${error.message || error}`, true);
    });

    try {
      startPageListener();
      if (new URLSearchParams(window.location.search).get('edit') === '1' && isEditor()) {
        editorMode = true;
      }
      render();
    } catch (error) {
      console.error(error);
      status(`Gallery load failed: ${error.message || error}`, true);
    }
  });
}

boot();
