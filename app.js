import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// -------------------------
// Helpers
// -------------------------
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function show(el) { el.classList.add("show"); el.setAttribute("aria-hidden", "false"); }
function hide(el) { el.classList.remove("show"); el.setAttribute("aria-hidden", "true"); }

function notice(msg, type = "") {
  const box = $("authNotice");
  box.textContent = msg || "";
  box.className = "notice" + (type ? ` ${type}` : "");
  if (!msg) box.className = "notice";
}

function normalizeEmail(e) { return (e || "").trim().toLowerCase(); }

function allowedEmail(email) {
  const dom = normalizeEmail(email).split("@")[1] || "";
  return (window.ALLOWED_EMAIL_DOMAINS || []).some((d) => d.toLowerCase() === dom);
}

function isAdmin(email) {
  const e = normalizeEmail(email);
  return (window.ADMIN_EMAILS || []).map((x) => x.toLowerCase()).includes(e);
}

// -------------------------
// Background slideshow
// -------------------------
const bgRoot = $("bg");
const bgLayerA = document.createElement("div");
const bgLayerB = document.createElement("div");
bgLayerA.className = "bg-layer";
bgLayerB.className = "bg-layer";
const dim = document.createElement("div");
// dim class is applied via ::before gradient; keep as safety overlay
bgRoot.appendChild(bgLayerA);
bgRoot.appendChild(bgLayerB);

async function imageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function initBackground() {
  // Try both folder cases (Images vs images)
  const sets = [
    ["Images/regal1.jpg", "Images/regal2.jpg", "Images/regal3.jpg"],
    ["images/regal1.jpg", "images/regal2.jpg", "images/regal3.jpg"],
  ];

  let imgs = null;
  for (const set of sets) {
    if (await imageExists(set[0])) { imgs = set; break; }
  }
  if (!imgs) {
    // no images in repo; keep gradient background
    return;
  }

  let idx = 0;
  let showingA = true;

  function paint(url) {
    const showLayer = showingA ? bgLayerA : bgLayerB;
    const hideLayer = showingA ? bgLayerB : bgLayerA;

    showLayer.style.backgroundImage = `url('${url}')`;
    showLayer.classList.add("show");
    hideLayer.classList.remove("show");
    showingA = !showingA;
  }

  paint(imgs[idx]);
  setInterval(() => {
    idx = (idx + 1) % imgs.length;
    paint(imgs[idx]);
  }, 6000);
}

// -------------------------
// Firebase init (config safety)
// -------------------------
const cfg = window.FIREBASE_CONFIG;

function configLooksValid(c) {
  if (!c) return false;
  const required = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
  return required.every((k) => typeof c[k] === "string" && c[k] && !c[k].includes("PASTE_"));
}

let app, auth, db, storage;

function openAuthModal(defaultTab = "login") {
  show($("authModal"));
  setAuthTab(defaultTab);
}

function setAuthTab(tab) {
  qsa(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("tab-login").classList.toggle("hidden", tab !== "login");
  $("tab-signup").classList.toggle("hidden", tab !== "signup");
  notice("");
}

function hardStopConfig() {
  // Make it obvious why login does nothing
  openAuthModal("login");
  notice(
    "Firebase is not configured (apiKey not valid). Open firebase-config.js in GitHub and paste your Firebase Web App config values.",
    "bad"
  );
  // disable buttons to prevent confusion
  $("btnLogin").disabled = true;
  $("btnSignup").disabled = true;
  $("btnForgot").disabled = true;
}

function initFirebase() {
  if (!configLooksValid(cfg)) {
    hardStopConfig();
    return false;
  }
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  return true;
}

// -------------------------
// UI state
// -------------------------
let currentUser = null;
let currentBoard = "all";
let currentStatus = "active";
let currentSort = "newest";
let unsubscribePosts = null;

function setAuthPill() {
  const pill = $("authPill");
  if (!currentUser) {
    pill.textContent = "Not signed in";
    pill.className = "pill pill-muted";
    return;
  }
  const name = currentUser.displayName || currentUser.email;
  pill.textContent = `${name}` + (isAdmin(currentUser.email) ? " • Admin" : "");
  pill.className = "pill pill-ok";
}

function requireLogin(actionName = "do that") {
  if (!currentUser) {
    openAuthModal("login");
    notice(`Please login to ${actionName}.`, "bad");
    return false;
  }
  if (!currentUser.emailVerified) {
    openAuthModal("login");
    notice("Please verify your email before using the marketplace. Check your inbox.", "bad");
    return false;
  }
  return true;
}

// -------------------------
// Posts + Threads
// -------------------------
function postsQuery() {
  const postsCol = collection(db, "posts");

  const filters = [];
  if (currentBoard !== "all") filters.push(where("board", "==", currentBoard));

  if (currentStatus !== "all") filters.push(where("status", "==", currentStatus));

  const sort = currentSort === "oldest" ? orderBy("createdAt", "asc") : orderBy("createdAt", "desc");

  return query(postsCol, ...filters, sort);
}

function renderFeed(posts) {
  const feed = $("feed");
  feed.innerHTML = "";

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No posts yet.";
    feed.appendChild(empty);
    $("resultCount").textContent = "0 shown";
    return;
  }

  for (const p of posts) {
    const card = document.createElement("article");
    card.className = "card";

    const media = document.createElement("div");
    media.className = "card-media";

    if (Array.isArray(p.photoUrls) && p.photoUrls.length) {
      const img = document.createElement("img");
      img.src = p.photoUrls[0];
      img.alt = p.title || "Photo";
      media.appendChild(img);
    } else {
      media.textContent = "No photo";
    }

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = p.title || "(no title)";

    const sub = document.createElement("div");
    sub.className = "card-sub";
    const price = (p.price || "").toString().trim();
    const who = p.authorName || p.authorEmail || "";
    sub.textContent = `${price ? price + " • " : ""}${prettyBoard(p.board)} • ${who}`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = p.status === "closed" ? "Closed" : "Active";

    const openBtn = document.createElement("button");
    openBtn.className = "btn";
    openBtn.textContent = "Open Thread";
    openBtn.type = "button";
    openBtn.dataset.action = "open-thread";
    openBtn.dataset.id = p.id;

    actions.appendChild(tag);
    actions.appendChild(openBtn);

    body.appendChild(title);
    body.appendChild(sub);
    body.appendChild(actions);

    card.appendChild(media);
    card.appendChild(body);

    feed.appendChild(card);
  }

  $("resultCount").textContent = `${posts.length} shown`;
}

function prettyBoard(b) {
  const map = { free: "Free Items", sell: "Buy / Sell", garage: "Garage Sales", events: "Events", work: "Work News" };
  return map[b] || "All";
}

function startPostsListener() {
  if (unsubscribePosts) unsubscribePosts();

  const q = postsQuery();
  unsubscribePosts = onSnapshot(q, (snap) => {
    const posts = [];
    snap.forEach((d) => posts.push({ id: d.id, ...d.data() }));

    // search filter client-side
    const needle = ($("searchInput").value || "").trim().toLowerCase();
    const filtered = needle
      ? posts.filter((p) => (p.title || "").toLowerCase().includes(needle) || (p.desc || "").toLowerCase().includes(needle))
      : posts;

    renderFeed(filtered);
  });
}

// Thread modal
let openThreadId = null;
let unsubscribeThread = null;

async function openThread(postId) {
  if (!requireLogin("open threads")) return;

  openThreadId = postId;
  show($("threadModal"));

  const postRef = doc(db, "posts", postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) {
    $("tTitle").textContent = "Thread";
    $("tMeta").textContent = "Post not found.";
    $("tBody").textContent = "";
    $("tComments").innerHTML = "";
    return;
  }

  const p = postSnap.data();
  $("tTitle").textContent = p.title || "Thread";
  $("tMeta").textContent = `${prettyBoard(p.board)} • ${p.price || ""} • ${p.authorName || p.authorEmail || ""}`;
  $("tBody").textContent = p.desc || "";

  if (unsubscribeThread) unsubscribeThread();
  const commentsCol = collection(db, "posts", postId, "comments");
  const cq = query(commentsCol, orderBy("createdAt", "asc"));
  unsubscribeThread = onSnapshot(cq, (snap) => {
    const wrap = $("tComments");
    wrap.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      const div = document.createElement("div");
      div.className = "comment";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${c.authorName || c.authorEmail || ""}`;
      const body = document.createElement("div");
      body.textContent = c.text || "";
      div.appendChild(meta);
      div.appendChild(body);
      wrap.appendChild(div);
    });
  });
}

async function sendReply() {
  if (!requireLogin("reply")) return;
  if (!openThreadId) return;

  const text = ($("tReply").value || "").trim();
  if (!text) return;

  await addDoc(collection(db, "posts", openThreadId, "comments"), {
    text,
    authorEmail: currentUser.email,
    authorName: currentUser.displayName || "",
    createdAt: serverTimestamp(),
  });

  $("tReply").value = "";
}

function closeThread() {
  hide($("threadModal"));
  openThreadId = null;
  if (unsubscribeThread) unsubscribeThread();
  unsubscribeThread = null;
}

// Create post
async function createPost() {
  if (!requireLogin("post")) return;

  const title = ($("pTitle").value || "").trim();
  const board = $("pBoard").value;
  const price = ($("pPrice").value || "").trim();
  const contact = ($("pContact").value || "").trim();
  const desc = ($("pDesc").value || "").trim();

  if (!title || !desc) {
    alert("Please enter a title and description.");
    return;
  }

  // photos: limit 3
  const files = Array.from($("pPhotos").files || []).slice(0, 3);
  const photoUrls = [];

  // Upload photos (optional)
  for (const f of files) {
    const safeName = f.name.replace(/[^a-z0-9_.-]/gi, "_");
    const path = `postPhotos/${currentUser.uid}/${Date.now()}_${safeName}`;
    const r = ref(storage, path);
    await uploadBytes(r, f);
    const url = await getDownloadURL(r);
    photoUrls.push(url);
  }

  await addDoc(collection(db, "posts"), {
    title,
    board,
    price,
    contact,
    desc,
    photoUrls,
    authorEmail: currentUser.email,
    authorName: currentUser.displayName || "",
    status: "active",
    createdAt: serverTimestamp(),
  });

  closePost();
}

function openPost() {
  if (!requireLogin("post")) return;
  show($("postModal"));
}

function closePost() {
  hide($("postModal"));
  $("pTitle").value = "";
  $("pPrice").value = "";
  $("pContact").value = "";
  $("pDesc").value = "";
  $("pPhotos").value = "";
}

// -------------------------
// Auth
// -------------------------
async function doLogin() {
  const email = normalizeEmail($("loginEmail").value);
  const pass = $("loginPass").value || "";

  if (!email || !pass) {
    notice("Enter email and password.", "bad");
    return;
  }
  if (!allowedEmail(email)) {
    notice("Use your work email (@regallakeland.com).", "bad");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    notice("Logged in.", "ok");
    hide($("authModal"));
  } catch (e) {
    notice(e?.message || "Login failed.", "bad");
  }
}

async function doForgot() {
  const email = normalizeEmail($("loginEmail").value);
  if (!email) {
    notice("Enter your email first.", "bad");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    notice("Password reset email sent.", "ok");
  } catch (e) {
    notice(e?.message || "Reset failed.", "bad");
  }
}

async function doSignup() {
  const first = ($("suFirst").value || "").trim();
  const last = ($("suLast").value || "").trim();
  const email = normalizeEmail($("suEmail").value);
  const pass = $("suPass").value || "";
  const pass2 = $("suPass2").value || "";
  const agree = $("suAgree").checked;

  if (!first || !last) {
    notice("Enter first and last name.", "bad");
    return;
  }
  if (!agree) {
    notice("You must agree to the rules.", "bad");
    return;
  }
  if (!allowedEmail(email)) {
    notice("Use your work email (@regallakeland.com).", "bad");
    return;
  }
  if (pass.length < 8) {
    notice("Password must be at least 8 characters.", "bad");
    return;
  }
  if (pass !== pass2) {
    notice("Passwords do not match.", "bad");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: `${first} ${last}` });
    await sendEmailVerification(cred.user);

    // Create user profile doc
    await addDoc(collection(db, "profiles"), {
      uid: cred.user.uid,
      email,
      name: `${first} ${last}`,
      createdAt: serverTimestamp(),
      // NOTE: GitHub Pages cannot securely capture IP addresses.
      // IP collection requires a server (Cloud Functions / backend).
    });

    notice("Account created. Verify your email (check inbox) then login.", "ok");
    setAuthTab("login");
    $("loginEmail").value = email;
  } catch (e) {
    notice(e?.message || "Signup failed.", "bad");
  }
}

// -------------------------
// Wiring
// -------------------------
function wireUI() {
  // Modals
  $("authClose").onclick = () => hide($("authModal"));
  $("postClose").onclick = () => closePost();
  $("threadClose").onclick = () => closeThread();

  // Tabs
  qsa(".tab").forEach((t) => (t.onclick = () => setAuthTab(t.dataset.tab)));

  // Auth actions
  $("btnLogin").onclick = doLogin;
  $("btnForgot").onclick = doForgot;
  $("btnSignup").onclick = doSignup;

  // Posting
  $("btnNewPost").onclick = () => openPost();
  $("btnPost").onclick = () => createPost();

  // Thread reply
  $("btnReply").onclick = () => sendReply();

  // Board selection
  $("boardList").addEventListener("click", (e) => {
    const btn = e.target.closest(".board");
    if (!btn) return;
    qsa(".board").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentBoard = btn.dataset.board;
    startPostsListener();
  });

  // Filters
  $("statusSelect").addEventListener("change", () => {
    currentStatus = $("statusSelect").value;
    startPostsListener();
  });
  $("sortSelect").addEventListener("change", () => {
    currentSort = $("sortSelect").value;
    startPostsListener();
  });
  $("searchInput").addEventListener("input", () => {
    // just re-render by restarting listener (cheap + simple)
    startPostsListener();
  });

  // Feed action delegation
  $("feed").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.action === "open-thread") {
      openThread(btn.dataset.id);
    }
  });

  // Auth pill click: open auth modal / logout
  $("authPill").addEventListener("click", async () => {
    if (!currentUser) {
      openAuthModal("login");
      return;
    }
    // quick action menu: shift-click logs out
    if (confirm("Logout?")) {
      await signOut(auth);
    }
  });
}

async function main() {
  await initBackground();
  wireUI();

  const ok = initFirebase();
  if (!ok) return;

  // Start auth listener
  onAuthStateChanged(auth, async (u) => {
    currentUser = u;
    setAuthPill();

    if (!u) {
      // Not signed in: open login
      openAuthModal("login");
      return;
    }

    // Enforce allowed domain
    if (!allowedEmail(u.email)) {
      alert("This site requires a work email.");
      await signOut(auth);
      return;
    }

    // Enforce verification
    if (!u.emailVerified) {
      openAuthModal("login");
      notice("Verify your email before using the marketplace (check inbox).", "bad");
      return;
    }

    hide($("authModal"));
    startPostsListener();
  });
}

main();
