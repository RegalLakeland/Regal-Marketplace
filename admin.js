
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
  getDocs,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB6IAiH6zILQKuJRuXc55Q4hEX8q6F2kxE",
  authDomain: "regal-lakeland-marketplace.firebaseapp.com",
  projectId: "regal-lakeland-marketplace",
  storageBucket: "regal-lakeland-marketplace.firebasestorage.app",
  messagingSenderId: "1014346693296",
  appId: "1:1014346693296:web:fc76118d1a8db347945975"
};

const ADMINS = new Set([
  "Michael.H@regallakeland.com",
  "janni.r@regallakeland.com",
  "chrissy.h@regallakeland.com",
  "amy.m@regallakeland.com"
].map(x => x.toLowerCase()));

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const show = (id) => { $(id).style.display = "flex"; };
const hide = (id) => { $(id).style.display = "none"; };
const esc = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

let user = null;
let isAdmin = false;
let allPosts = [];
let allUsers = [];

function prettyTime(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : (typeof ts === "number" ? new Date(ts) : null);
    if (!d) return "—";
    return d.toLocaleString();
  }catch{ return "—";}
}

function renderPosts(){
  const wrap = $("tableWrap");
  const q = ($("q").value || "").trim().toLowerCase();
  const board = $("board").value;

  let posts = allPosts.slice();
  if (q) posts = posts.filter(p => `${p.title} ${p.userEmail}`.toLowerCase().includes(q));
  if (board !== "ALL") posts = posts.filter(p => p.category === board);

  $("countLine").textContent = `${posts.length} posts`;

  let html = `<table class="adminTable"><thead><tr>
    <th>Title</th><th>Board</th><th>User</th><th>Posted</th><th>Actions</th>
  </tr></thead><tbody>`;

  for(const p of posts){
    html += `<tr data-id="${p.id}">
      <td>${esc(p.title)}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.userEmail)}</td>
      <td>${esc(prettyTime(p.createdAtMs))}</td>
      <td><button class="btn mini danger" data-action="deletePost">Delete</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function renderUsers(){
  const wrap = $("usersWrap");
  const q = ($("uq").value || "").trim().toLowerCase();
  let users = allUsers.slice();
  if (q) users = users.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q));

  $("userCountLine").textContent = `${users.length} users`;
  
  let html = `<table class="adminTable"><thead><tr>
    <th>Name</th><th>Email</th><th>Last Seen</th><th>Actions</th>
  </tr></thead><tbody>`;

  for(const u of users){
    const isBanned = u.banned;
    html += `<tr data-id="${u.id}">
      <td>${esc(u.name)}</td>
      <td>${esc(u.email)}</td>
      <td>${esc(prettyTime(u.lastSeenAtMs))}</td>
      <td><button class="btn mini ${isBanned ? '' : 'danger'}" data-action="toggleBan">${isBanned ? 'Unban' : 'Ban'}</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}


async function loadAdminData(){
  onSnapshot(query(collection(db, "listings"), orderBy("createdAtMs", "desc")), (snap)=>{
    allPosts = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPosts();
  });

  onSnapshot(query(collection(db, "profiles"), orderBy("lastSeenAtMs", "desc")), (snap)=>{
    allUsers = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderUsers();
  });
}

$("btnLogin")?.addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const pass = $("loginPassword").value.trim();
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
  location.reload();
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  isAdmin = user && ADMINS.has(user.email.toLowerCase());

  if (isAdmin) {
    hide("loginOverlay");
    $("pillUser").textContent = user.email;
    loadAdminData();
  } else {
    show("loginOverlay");
    $("pillUser").textContent = "Not signed in";
    if (user) {
      alert("You do not have admin permissions.");
      await signOut(auth);
    }
  }
});

document.body.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const row = btn.closest("tr");
  const id = row?.dataset.id;
  if (!id) return;

  if (action === "deletePost"){
    if (confirm(`Delete post ${id}?`)) {
      await deleteDoc(doc(db, "listings", id));
    }
  }

  if (action === "toggleBan"){
    const userRef = doc(db, "profiles", id);
    const userSnap = await getDoc(userRef);
    const isBanned = userSnap.data()?.banned;
    if (confirm(`${isBanned ? 'Unban' : 'Ban'} user ${id}?`)){
      await setDoc(userRef, { banned: !isBanned }, { merge: true });
    }
  }
});

$("q").addEventListener("input", renderPosts);
$("board").addEventListener("input", renderPosts);
$("uq").addEventListener("input", renderUsers);
