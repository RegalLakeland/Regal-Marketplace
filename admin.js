import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

let user = null;
let allPosts = [];
let allUsers = [];
let postsUnsub = null;
let usersUnsub = null;

function prettyTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (typeof ts === "number" ? new Date(ts) : null);
    if (!d) return "-";
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}

function cleanupAdminListeners() {
  if (postsUnsub) { postsUnsub(); postsUnsub = null; }
  if (usersUnsub) { usersUnsub(); usersUnsub = null; }
}

function renderPosts() {
  const wrap = $("tableWrap");
  if (!wrap) return;

  const qText = ($("q")?.value || "").trim().toLowerCase();
  const board = $("board")?.value || "ALL";
  const status = $("statusFilter")?.value || "ALL";

  let posts = allPosts.slice();
  if (qText) {
    posts = posts.filter(p => `${p.title || ""} ${p.authorEmail || p.userEmail || ""}`.toLowerCase().includes(qText));
  }
  if (board !== "ALL") {
    posts = posts.filter(p => (p.board || p.category) === board);
  }
  if (status !== "ALL") {
    posts = posts.filter(p => (p.status || "ACTIVE") === status);
  }

  if ($("countLine")) $("countLine").textContent = `${posts.length} posts`;

  wrap.innerHTML = `
    <table class="adminTable">
      <thead>
        <tr>
          <th>Title</th>
          <th>Board</th>
          <th>User</th>
          <th>Status</th>
          <th>Posted</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${posts.map(p => `
          <tr data-id="${esc(p.id)}">
            <td>${esc(p.title || "")}</td>
            <td>${esc(p.board || p.category || "")}</td>
            <td>${esc(p.authorEmail || p.userEmail || "")}</td>
            <td>${esc(p.status || "ACTIVE")}</td>
            <td>${esc(prettyTime(p.createdAtMs))}</td>
            <td>
              <div class="rowBtns">
                ${(p.status || "ACTIVE") !== "SOLD" ? `<button class="btn" data-action="markSold">Mark Sold</button>` : ""}
                <button class="btn danger" data-action="deletePost">Delete</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderUsers() {
  const wrap = $("usersWrap");
  if (!wrap) return;

  const qText = ($("uq")?.value || "").trim().toLowerCase();
  let users = allUsers.slice();
  if (qText) {
    users = users.filter(u => `${u.displayName || ""} ${u.name || ""} ${u.email || ""}`.toLowerCase().includes(qText));
  }

  if ($("userCountLine")) $("userCountLine").textContent = `${users.length} users`;

  wrap.innerHTML = `
    <table class="adminTable">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Admin</th>
          <th>Banned</th>
          <th>Updated</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr data-id="${esc(u.uid || u.id)}">
            <td>${esc(u.displayName || u.name || "-")}</td>
            <td>${esc(u.email || "-")}</td>
            <td>${u.isAdmin ? "Yes" : "No"}</td>
            <td>${u.banned ? "Yes" : "No"}</td>
            <td>${esc(prettyTime(u.updatedAtMs || u.lastSeenAtMs))}</td>
            <td>
              <button class="btn ${u.banned ? "" : "danger"}" data-action="toggleBan">${u.banned ? "Unban" : "Ban"}</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function startAdminListeners() {
  cleanupAdminListeners();

  postsUnsub = onSnapshot(query(collection(db, "listings"), orderBy("createdAtMs", "desc")), (snap) => {
    allPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPosts();
  });

  usersUnsub = onSnapshot(query(collection(db, "profiles"), orderBy("email", "asc")), (snap) => {
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsers();
  });
}

$("adminLoginButton")?.addEventListener("click", async () => {
  const email = $("adminLoginEmail")?.value.trim();
  const pass = $("adminLoginPassword")?.value.trim();
  if (!email || !pass) return alert("Enter email and password.");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    console.error(e);
    alert("Admin login failed.");
  }
});

$("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
});

$("q")?.addEventListener("input", renderPosts);
$("board")?.addEventListener("input", renderPosts);
$("statusFilter")?.addEventListener("input", renderPosts);
$("uq")?.addEventListener("input", renderUsers);

document.body.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const row = btn.closest("tr");
  const id = row?.dataset.id;
  if (!id) return;

  if (action === "deletePost") {
    if (!confirm("Delete this post?")) return;
    await deleteDoc(doc(db, "listings", id));
  }

  if (action === "markSold") {
    await updateDoc(doc(db, "listings", id), { status: "SOLD" });
  }

  if (action === "toggleBan") {
    const ref = doc(db, "profiles", id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const nextState = !existing.banned;
    await setDoc(ref, { banned: nextState }, { merge: true });
  }
});

onAuthStateChanged(auth, async (u) => {
  user = u || null;

  if (!user) {
    cleanupAdminListeners();
    if ($("pillUser")) $("pillUser").textContent = "Not signed in";
    if ($("adminLoginOverlay")) $("adminLoginOverlay").style.display = "flex";
    return;
  }

  if (!isAdminEmail(user.email)) {
    alert("You do not have admin permissions.");
    await signOut(auth);
    return;
  }

  if ($("pillUser")) $("pillUser").textContent = user.email || "Admin";
  if ($("adminLoginOverlay")) $("adminLoginOverlay").style.display = "none";
  startAdminListeners();
});
