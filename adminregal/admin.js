import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function show(el) { el.classList.add("show"); el.setAttribute("aria-hidden", "false"); }
function hide(el) { el.classList.remove("show"); el.setAttribute("aria-hidden", "true"); }
function notice(msg, type = "") {
  const box = $("authNotice");
  box.textContent = msg || "";
  box.className = "notice" + (type ? ` ${type}` : "");
}

function normalizeEmail(e) { return (e || "").trim().toLowerCase(); }
function isAdmin(email) {
  const e = normalizeEmail(email);
  return (window.ADMIN_EMAILS || []).map((x) => x.toLowerCase()).includes(e);
}

const cfg = window.FIREBASE_CONFIG;
function configLooksValid(c) {
  if (!c) return false;
  const required = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
  return required.every((k) => typeof c[k] === "string" && c[k] && !c[k].includes("PASTE_"));
}

if (!configLooksValid(cfg)) {
  show($("authModal"));
  notice("Firebase not configured. Fix firebase-config.js first.", "bad");
  $("btnLogin").disabled = true;
  $("btnForgot").disabled = true;
} else {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let currentUser = null;
  let unsub = null;

  function setPill() {
    const pill = $("authPill");
    if (!currentUser) {
      pill.textContent = "Not signed in";
      pill.className = "pill pill-muted";
      return;
    }
    pill.textContent = `${currentUser.displayName || currentUser.email} • Admin`;
    pill.className = "pill pill-ok";
  }

  async function doLogin() {
    const email = normalizeEmail($("loginEmail").value);
    const pass = $("loginPass").value || "";
    if (!email || !pass) { notice("Enter email and password.", "bad"); return; }
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      hide($("authModal"));
    } catch (e) {
      notice(e?.message || "Login failed.", "bad");
    }
  }

  async function doForgot() {
    const email = normalizeEmail($("loginEmail").value);
    if (!email) { notice("Enter your email first.", "bad"); return; }
    try { await sendPasswordResetEmail(auth, email); notice("Reset email sent.", "ok"); }
    catch (e) { notice(e?.message || "Reset failed.", "bad"); }
  }

  function prettyBoard(b) {
    const map = { free: "Free Items", sell: "Buy / Sell", garage: "Garage Sales", events: "Events", work: "Work News" };
    return map[b] || "All";
  }

  function buildQuery() {
    const board = $("filterBoard").value;
    const status = $("filterStatus").value;

    const base = collection(db, "posts");
    const parts = [];
    if (board !== "all") parts.push(where("board", "==", board));
    if (status !== "all") parts.push(where("status", "==", status));
    parts.push(orderBy("createdAt", "desc"));
    return query(base, ...parts);
  }

  function listen() {
    if (unsub) unsub();
    unsub = onSnapshot(buildQuery(), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      render(rows);
      $("adminStatus").textContent = `${rows.length} posts`;
    });
  }

  function render(posts) {
    const feed = $("adminFeed");
    feed.innerHTML = "";
    if (!posts.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No posts.";
      feed.appendChild(empty);
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
      sub.textContent = `${prettyBoard(p.board)} • ${p.authorName || p.authorEmail || ""}`;

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = "Delete";
      del.dataset.action = "delete";
      del.dataset.id = p.id;

      const close = document.createElement("button");
      close.className = "btn";
      close.textContent = p.status === "closed" ? "Reopen" : "Close";
      close.dataset.action = "toggle";
      close.dataset.id = p.id;
      close.dataset.status = p.status || "active";

      actions.appendChild(close);
      actions.appendChild(del);

      body.appendChild(title);
      body.appendChild(sub);
      body.appendChild(actions);

      card.appendChild(media);
      card.appendChild(body);
      feed.appendChild(card);
    }
  }

  $("adminFeed").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;

    if (btn.dataset.action === "delete") {
      if (!confirm("Delete this post?")) return;
      await deleteDoc(doc(db, "posts", id));
    }

    if (btn.dataset.action === "toggle") {
      const cur = btn.dataset.status;
      const next = cur === "closed" ? "active" : "closed";
      await updateDoc(doc(db, "posts", id), { status: next });
    }
  });

  $("filterBoard").addEventListener("change", listen);
  $("filterStatus").addEventListener("change", listen);

  $("authClose").onclick = () => hide($("authModal"));
  $("btnLogin").onclick = doLogin;
  $("btnForgot").onclick = doForgot;

  $("authPill").addEventListener("click", async () => {
    if (!currentUser) {
      show($("authModal"));
      return;
    }
    if (confirm("Logout?")) await signOut(auth);
  });

  onAuthStateChanged(auth, async (u) => {
    currentUser = u;
    setPill();

    if (!u) {
      show($("authModal"));
      notice("Login with an admin account.", "bad");
      return;
    }

    if (!isAdmin(u.email)) {
      alert("Admin access required.");
      await signOut(auth);
      return;
    }

    hide($("authModal"));
    $("adminStatus").textContent = "Admin signed in.";
    listen();
  });
}
