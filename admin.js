import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, updateDoc, deleteDoc, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const root = document.getElementById("adminRoot");

function formatDate(v){
  if(!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function renderBlocked(msg){
  root.innerHTML = `<div class="panel-card"><div class="empty">${esc(msg)}</div></div>`;
}
function renderAdmin(users, posts, alerts){
  const bannedCount = users.filter(u => u.banned).length;
  root.innerHTML = `
    <div class="stats">
      <div class="stat-box"><div class="stat-label">Posts</div><div class="stat-value">${posts.length}</div></div>
      <div class="stat-box"><div class="stat-label">Users</div><div class="stat-value">${users.length}</div></div>
      <div class="stat-box"><div class="stat-label">Alerts</div><div class="stat-value">${alerts.length}</div></div>
      <div class="stat-box"><div class="stat-label">Banned</div><div class="stat-value">${bannedCount}</div></div>
    </div>

    <div class="admin-grid">
      <div class="panel-card">
        <h2 style="margin-bottom:12px">Users</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
            <tbody>
              ${users.length ? users.map(u => `
                <tr>
                  <td>${esc(u.displayName)}</td>
                  <td>${esc(u.email)}</td>
                  <td>${esc(u.role || "user")}</td>
                  <td><button class="btn ${u.banned ? "" : "danger"} ban-btn" data-id="${u.id}" data-next="${u.banned ? "false" : "true"}" type="button">${u.banned ? "Unban" : "Ban"}</button></td>
                </tr>
              `).join("") : `<tr><td colspan="4">No users</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel-card">
        <h2 style="margin-bottom:12px">Moderation Alerts</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Post</th><th>By</th><th>Time</th></tr></thead>
            <tbody>
              ${alerts.length ? alerts.map(a => `
                <tr>
                  <td>${esc(a.type)}</td>
                  <td>${esc(a.postTitle)}</td>
                  <td>${esc(a.byEmail)}</td>
                  <td>${formatDate(a.createdAt)}</td>
                </tr>
              `).join("") : `<tr><td colspan="4">No alerts</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel-card" style="grid-column:1 / -1">
        <h2 style="margin-bottom:12px">Posts</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Section</th><th>Owner</th><th>Status</th><th>Replies</th><th>Views</th><th>Action</th></tr></thead>
            <tbody>
              ${posts.length ? posts.map(p => `
                <tr>
                  <td>${esc(p.title)}</td>
                  <td>${esc(p.sectionId)}</td>
                  <td>${esc(p.authorName)}<br><span class="sub">${esc(p.ownerEmail)}</span></td>
                  <td>${esc(p.status || "active")}</td>
                  <td>${(p.replies || []).length}</td>
                  <td>${p.views || 0}</td>
                  <td><button class="btn danger post-del-btn" data-id="${p.id}" type="button">Delete</button></td>
                </tr>
              `).join("") : `<tr><td colspan="7">No posts</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.querySelectorAll(".ban-btn").forEach(btn => btn.addEventListener("click", async () => {
    await updateDoc(doc(db, "profiles", btn.dataset.id), { banned: btn.dataset.next === "true" });
  }));
  document.querySelectorAll(".post-del-btn").forEach(btn => btn.addEventListener("click", async () => {
    if(confirm("Delete this post?")){
      await deleteDoc(doc(db, "posts", btn.dataset.id));
    }
  }));
}

onAuthStateChanged(auth, async (user) => {
  if(!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())){
    renderBlocked("Admin access required. Log in on the main site with an approved admin email first.");
    return;
  }
  const usersQ = query(collection(db, "profiles"), orderBy("createdAt", "desc"));
  const postsQ = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  const alertsQ = query(collection(db, "moderationAlerts"), orderBy("createdAt", "desc"));

  let users = [], posts = [], alerts = [];
  onSnapshot(usersQ, snap => { users = snap.docs.map(d => ({ id:d.id, ...d.data() })); renderAdmin(users, posts, alerts); });
  onSnapshot(postsQ, snap => { posts = snap.docs.map(d => ({ id:d.id, ...d.data() })); renderAdmin(users, posts, alerts); });
  onSnapshot(alertsQ, snap => { alerts = snap.docs.map(d => ({ id:d.id, ...d.data() })); renderAdmin(users, posts, alerts); });
});
