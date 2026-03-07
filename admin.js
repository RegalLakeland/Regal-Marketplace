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
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  orderBy
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
let posts = [];
let profiles = [];

$("btnLogin").addEventListener("click", async ()=>{
  const email = $("loginEmail").value.trim();
  const pass = $("loginPassword").value.trim();
  if (!email || !pass) return alert("Enter email and password.");
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    alert("Login failed.");
  }
});

$("btnLogout").addEventListener("click", async ()=>{
  await signOut(auth);
  location.reload();
});

function render(){
  const qText = ($("q").value || "").toLowerCase().trim();
  const board = $("board").value;

  let list = posts.slice();
  if (board !== "ALL") list = list.filter(p => p.category === board);
  if (qText) list = list.filter(p => (`${p.title} ${p.userEmail}`.toLowerCase()).includes(qText));

  $("countLine").textContent = `${list.length} posts`;

  let html = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Title</th>
          <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Board</th>
          <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Posted By</th>
          <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Photo</th>
          <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)"></th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const p of list){
    html += `
      <tr>
        <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.title || "")}</td>
        <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.category || "")}</td>
        <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.userEmail || "")}</td>
        <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${p.photo ? "Yes" : "No"}</td>
        <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">
          <button class="btn danger" data-del="${esc(p.id)}">Delete</button>
        </td>
      </tr>
    `;
  }

  html += `</tbody></table>`;
  $("tableWrap").innerHTML = html;

  $("tableWrap").querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete this post?")) return;
      await deleteDoc(doc(db, "listings", id));
    });
  });
}

["q","board"].forEach(id => $(id).addEventListener("input", render));
["uq"].forEach(id => $(id).addEventListener("input", renderUsers));

function renderUsers(){
  const qText = ($("uq").value || "").toLowerCase().trim();
  let list = profiles.slice();
  if (qText){
    list = list.filter(p => (`${p.name||""} ${p.email||""} ${p.uid||""}`.toLowerCase()).includes(qText));
  }
  $("userCountLine").textContent = `${list.length} users`;
  let html = `<table style="width:100%;border-collapse:collapse"><thead><tr>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Name</th>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Email</th>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">UID</th>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Last Seen</th>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)">Status</th>
    <th style="text-align:left;padding:10px 6px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.1)"></th>
  </tr></thead><tbody>`;

  for (const p of list){
    const last = p.lastSeenAtMs ? new Date(p.lastSeenAtMs).toLocaleString() : "—";
    html += `<tr>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.name || "—")}</td>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.email || "—")}</td>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(p.uid || "—")}</td>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(last)}</td>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">${p.banned ? "BANNED" : "ACTIVE"}</td>
      <td style="padding:10px 6px;border-bottom:1px solid rgba(255,255,255,.08)">
        <button class="btn ${p.banned ? "" : "danger"}" data-ban="${esc(p.uid)}" data-state="${p.banned ? "unban" : "ban"}">${p.banned ? "Unban" : "Ban"}</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  $("usersWrap").innerHTML = html;
  $("usersWrap").querySelectorAll("[data-ban]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const uid = btn.getAttribute("data-ban");
      const state = btn.getAttribute("data-state");
      const willBan = state === "ban";
      if (!confirm(`${willBan ? "BAN" : "UNBAN"} this user?`)) return;
      await updateDoc(doc(db, "profiles", uid), { banned: willBan, bannedAtMs: Date.now() });
    });
  });
}

hide("loginOverlay");

onAuthStateChanged(auth, (u)=>{
  user = u;
  if (!user || !ADMINS.has(user.email.toLowerCase())) {
    user = null;
    show("loginOverlay");
    $("pillUser").textContent = "Not signed in";
    return;
  }

  hide("loginOverlay");
  $("pillUser").textContent = `Admin: ${user.email}`;

  const qy = query(collection(db, "listings"), orderBy("createdAtMs", "desc"));
  onSnapshot(qy, (snap)=>{
    posts = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    render();
  });

  const pq = query(collection(db, "profiles"), orderBy("lastSeenAtMs", "desc"));
  onSnapshot(pq, (snap)=>{
    profiles = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderUsers();
  });
});
