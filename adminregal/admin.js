import { firebaseConfig, ADMIN_EMAILS } from "../firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot, query, orderBy, updateDoc, deleteDoc, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

let user = null;
let posts = [];
let profiles = [];

function prettyTime(ms){
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function isAdminEmail(email){
  return ADMIN_EMAILS.has(String(email||"").toLowerCase());
}

function applyPostFilters(list){
  const q = ($("pq").value||"").toLowerCase().trim();
  const b = $("pboard").value;
  let out = list.slice();
  if (b !== "ALL") out = out.filter(x=> x.board === b);
  if (q){
    out = out.filter(x => (`${x.title} ${x.displayName} ${x.userEmail} ${x.uid}`.toLowerCase()).includes(q));
  }
  return out;
}

function renderPosts(){
  const list = applyPostFilters(posts);
  $("postCount").textContent = `${list.length}`;

  let html = `<table><thead><tr>
    <th>Title</th><th>Board</th><th>By</th><th>Email</th><th>Created</th><th>Replies</th><th></th>
  </tr></thead><tbody>`;

  for (const p of list){
    html += `<tr>
      <td>${esc(p.title||"")}</td>
      <td>${esc(p.board||"")}</td>
      <td>${esc(p.displayName||"—")}</td>
      <td>${esc(p.userEmail||"—")}</td>
      <td>${esc(prettyTime(p.createdAtMs))}</td>
      <td>${esc((p.replies||[]).length)}</td>
      <td>
        <button class="btn mini danger" data-del="${esc(p.id)}">Delete</button>
        <button class="btn mini" data-ban="${esc(p.uid)}">Ban User</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  $("postsTable").innerHTML = html;

  $("postsTable").querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete this post?")) return;
      await deleteDoc(doc(db, "listings", id));
    });
  });

  $("postsTable").querySelectorAll("[data-ban]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.getAttribute("data-ban");
      if (!confirm("Ban this user?")) return;
      await updateDoc(doc(db, "profiles", uid), { banned:true, bannedAtMs: Date.now() });
      alert("User banned.");
    });
  });
}

function applyUserFilters(list){
  const q = ($("uq").value||"").toLowerCase().trim();
  if (!q) return list;
  return list.filter(p => (`${p.name||""} ${p.email||""} ${p.uid||""}`.toLowerCase()).includes(q));
}

function renderUsers(){
  const list = applyUserFilters(profiles);
  $("userCount").textContent = `${list.length}`;

  let html = `<table><thead><tr>
    <th>Name</th><th>Email</th><th>UID</th><th>Last Seen</th><th>Status</th><th></th>
  </tr></thead><tbody>`;
  for (const p of list){
    html += `<tr>
      <td>${esc(p.name||"—")}</td>
      <td>${esc(p.email||"—")}</td>
      <td>${esc(p.uid||"—")}</td>
      <td>${esc(prettyTime(p.lastSeenAtMs))}</td>
      <td>${p.banned ? "BANNED" : "ACTIVE"}</td>
      <td>
        <button class="btn mini ${p.banned ? "" : "danger"}" data-toggle="${esc(p.uid)}" data-b="${p.banned ? "1":"0"}">
          ${p.banned ? "Unban" : "Ban"}
        </button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  $("usersTable").innerHTML = html;

  $("usersTable").querySelectorAll("[data-toggle]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.getAttribute("data-toggle");
      const banned = btn.getAttribute("data-b") === "1";
      const willBan = !banned;
      if (!confirm(`${willBan ? "BAN" : "UNBAN"} this user?`)) return;
      await updateDoc(doc(db, "profiles", uid), { banned: willBan, bannedAtMs: Date.now() });
    });
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  ["pq","pboard"].forEach(id => $(id).addEventListener("input", renderPosts));
  ["uq"].forEach(id => $(id).addEventListener("input", renderUsers));
  $("btnAdminLogout").addEventListener("click", async ()=>{
    await signOut(auth);
  });
});

onAuthStateChanged(auth, (u)=>{
  user = u;
  if (!user){
    $("adminUserPill").textContent = "Not signed in";
    $("btnAdminLogout").style.display = "none";
    alert("Admin login required. Go back to main site and log in.");
    return;
  }
  if (!user.emailVerified){
    alert("Verify your email first.");
    signOut(auth);
    return;
  }
  if (!isAdminEmail(user.email)){
    alert("Access denied.");
    signOut(auth);
    return;
  }

  $("adminUserPill").textContent = `Admin: ${user.email}`;
  $("btnAdminLogout").style.display = "inline-flex";

  const postQ = query(collection(db, "listings"), orderBy("createdAtMs","desc"));
  onSnapshot(postQ, (snap)=>{
    posts = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPosts();
  });

  const profQ = query(collection(db, "profiles"), orderBy("lastSeenAtMs","desc"));
  onSnapshot(profQ, (snap)=>{
    profiles = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderUsers();
  });
});
