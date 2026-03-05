import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let storage = null;
try { storage = getStorage(app); } catch { storage = null; }

const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

const DOMAIN = "@regallakeland.com";

const BOARD_DEFS = [
  { key: "ALL", name:"All", desc:"Everything in one place" },
  { key: "FREE", name:"Free Items", desc:"Giveaways • curb alerts" },
  { key: "BUYSELL", name:"Buy / Sell", desc:"Items for sale" },
  { key: "GARAGE", name:"Garage Sales", desc:"Yard sales • moving sales" },
  { key: "EVENTS", name:"Events", desc:"BBQ • meetups • birthdays" },
  { key: "WORK", name:"Work News", desc:"Updates • announcements" },
  { key: "SERVICES", name:"Local Services", desc:"Side work • help needed" },
];

let user = null;
let profile = null;
let isAdmin = false;

let listings = [];
let activeBoard = "ALL";
let openThreadId = null;
let openThreadUnsub = null;
let notifs = [];

function show(id){ $(id).style.display = "flex"; }
function hide(id){ $(id).style.display = "none"; }

function isAllowedEmail(email){
  const e = String(email||"").trim().toLowerCase();
  return e.endsWith(DOMAIN);
}

function prettyTime(ms){
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

async function loadProfile(){
  const refDoc = doc(db, "profiles", user.uid);
  const snap = await getDoc(refDoc);
  profile = snap.exists() ? snap.data() : null;
  return profile;
}

async function upsertProfile(extra={}){
  const refDoc = doc(db, "profiles", user.uid);
  const payload = {
    uid: user.uid,
    email: user.email,
    lastSeenAtMs: Date.now(),
    ...extra
  };
  await setDoc(refDoc, payload, { merge:true });
}

function displayName(){
  const n = (profile?.name || "").trim();
  if (n) return n;
  return (user?.email || "").split("@")[0] || "Employee";
}

function fmtPrice(v){
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  if (n <= 0) return "FREE";
  return "$" + n.toFixed(n % 1 === 0 ? 0 : 2);
}
function catLabel(c){
  return ({
    FREE:"Free Items", BUYSELL:"Buy / Sell", GARAGE:"Garage Sales",
    EVENTS:"Events", WORK:"Work News", SERVICES:"Local Services"
  })[c] || c;
}

function countByBoard(list){
  const map = { ALL: list.length };
  for (const b of BOARD_DEFS) map[b.key] = (b.key==="ALL")?list.length:0;
  for (const x of list){
    if (x.board && map[x.board] !== undefined) map[x.board]++;
  }
  return map;
}

function setActiveBoard(key){
  activeBoard = key;
  const def = BOARD_DEFS.find(b=>b.key===key) || BOARD_DEFS[0];
  $("boardPill").textContent = def.name;
  $("marketTitle").textContent = def.key==="ALL" ? "Marketplace" : def.name;
  [...$("boards").querySelectorAll(".boardBtn")].forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.key === key);
  });
  render();
}

function renderBoards(){
  const wrap = $("boards");
  const counts = countByBoard(listings);
  wrap.innerHTML = "";
  for (const b of BOARD_DEFS){
    const btn = document.createElement("button");
    btn.className = "boardBtn";
    btn.type = "button";
    btn.dataset.key = b.key;
    btn.innerHTML = `
      <div class="boardLeft">
        <div class="boardName">${esc(b.name)}</div>
        <div class="boardDesc">${esc(b.desc)}</div>
      </div>
      <div class="boardCount">${counts[b.key] ?? 0}</div>
    `;
    btn.addEventListener("click", ()=>setActiveBoard(b.key));
    wrap.appendChild(btn);
  }
  setActiveBoard(activeBoard);
}

function applyFilters(list){
  const q = $("q").value.trim().toLowerCase();
  const st = $("st").value;
  const sort = $("sort").value;

  let out = list.slice();
  if (activeBoard !== "ALL") out = out.filter(x=> x.board === activeBoard);

  if (q){
    out = out.filter(x => (`${x.title} ${x.desc} ${x.location} ${x.contact} ${x.displayName}`.toLowerCase()).includes(q));
  }
  if (st === "ACTIVE") out = out.filter(x => x.status !== "SOLD");
  if (st === "SOLD") out = out.filter(x => x.status === "SOLD");

  if (sort === "NEW") out.sort((a,b)=> (b.createdAtMs||0) - (a.createdAtMs||0));
  if (sort === "OLD") out.sort((a,b)=> (a.createdAtMs||0) - (b.createdAtMs||0));
  if (sort === "PRICE_ASC") out.sort((a,b)=> (Number(a.price)||0) - (Number(b.price)||0));
  if (sort === "PRICE_DESC") out.sort((a,b)=> (Number(b.price)||0) - (Number(a.price)||0));
  return out;
}

function render(){
  const cards = $("cards");
  const empty = $("empty");
  const filtered = applyFilters(listings);

  $("countLine").textContent = `${filtered.length} shown • ${listings.length} total`;
  cards.innerHTML = "";
  if (filtered.length === 0){
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const x of filtered){
    const priceText = fmtPrice(x.price);
    const isFree = priceText === "FREE" || x.board === "FREE" || Number(x.price) === 0;
    const badgeClass = x.status === "SOLD" ? "sold" : (isFree ? "free" : "");

    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="thumb">
        ${x.photoURL ? `<img src="${x.photoURL}" alt="">` : `<div style="color:rgba(156,163,175,.85);font-weight:1000;font-size:12px">No photo</div>`}
        <div class="badge ${badgeClass} ${x.status==="SOLD" ? "sold" : (isFree ? "free" : "")}">${x.status==="SOLD" ? "SOLD" : (isFree ? "FREE" : "AVAILABLE")}</div>
      </div>
      <div class="card-b">
        <div class="row">
          <div class="name">${esc(x.title)}</div>
          <div class="price">${esc(priceText || "—")}</div>
        </div>
        <div class="meta">${esc(catLabel(x.board))}${x.location ? ` • ${esc(x.location)}` : ""}</div>
        <div class="desc">${esc(x.desc||"").slice(0, 220)}${(x.desc||"").length>220 ? "…" : ""}</div>
      </div>
      <div class="card-f">
        <span class="tag">By: ${esc(x.displayName || x.userEmail || "—")}</span>
        <span class="tag">${x.contact ? `Contact: ${esc(x.contact)}` : "No contact listed"}</span>
        <button class="btn mini" data-act="thread" data-id="${esc(x.id)}" type="button">Open Thread</button>
      </div>
    `;
    cards.appendChild(el);
  }
}

function showPane(which){
  if (which === "login"){
    $("loginPane").style.display = "block";
    $("signupPane").style.display = "none";
    $("tabLogin").classList.add("active");
    $("tabSignup").classList.remove("active");
  } else {
    $("loginPane").style.display = "none";
    $("signupPane").style.display = "block";
    $("tabSignup").classList.add("active");
    $("tabLogin").classList.remove("active");
  }
}

async function requireProfileSetup(){
  await loadProfile();
  // If banned, kick
  if (profile?.banned){
    alert("Access removed by admin.");
    await signOut(auth);
    show("authOverlay");
    return false;
  }
  // Force name + rules agreement once
  const hasName = !!String(profile?.name||"").trim();
  const agreed = !!profile?.agreedRules;
  if (!hasName || !agreed){
    $("displayNameInput").value = profile?.name || "";
    $("agreeRules").checked = !!profile?.agreedRules;
    $("profileWarn").style.display = "none";
    show("profileOverlay");
    return false;
  }
  return true;
}

async function saveProfileSetup(){
  const name = ($("displayNameInput").value||"").trim();
  const agreed = $("agreeRules").checked;
  if (!name){
    $("profileWarn").style.display = "block";
    $("profileWarn").textContent = "Please enter your first and last name.";
    return;
  }
  if (!agreed){
    $("profileWarn").style.display = "block";
    $("profileWarn").textContent = "You must agree to the rules to continue.";
    return;
  }
  await upsertProfile({ name, agreedRules:true, agreedAtMs: Date.now() });
  await loadProfile();
  hide("profileOverlay");
  $("pillUser").textContent = `Signed in: ${displayName()}`;
}

async function uploadPhotoIfAny(file, postId){
  if (!file) return "";
  if (!storage) return "";
  if (!file.type.startsWith("image/")) return "";
  const maxBytes = 2.5 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error("Image too large. Keep it under 2.5 MB.");
  const path = `postPhotos/${postId}/${Date.now()}_${file.name}`.replaceAll(" ", "_");
  const r = sRef(storage, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

function clearPostForm(){
  $("fBoard").value = "FREE";
  $("fStatus").value = "ACTIVE";
  $("fTitle").value = "";
  $("fPrice").value = "";
  $("fLocation").value = "";
  $("fDesc").value = "";
  $("fContact").value = "";
  $("fPhoto").value = "";
  $("postWarn").style.display = "none";
}

async function createPost(){
  $("postWarn").style.display = "none";

  const title = $("fTitle").value.trim();
  if (!title){
    $("postWarn").style.display = "block";
    $("postWarn").textContent = "Title is required.";
    return;
  }
  const priceRaw = $("fPrice").value.trim();
  let price = "";
  if (priceRaw !== ""){
    const n = Number(priceRaw);
    if (!Number.isFinite(n) || n < 0){
      $("postWarn").style.display = "block";
      $("postWarn").textContent = "Price must be 0 or more.";
      return;
    }
    price = n;
  }

  // Create doc first (so we can store image under doc id)
  const col = collection(db, "listings");
  const docRef = await addDoc(col, {
    uid: user.uid,
    userEmail: user.email,
    displayName: displayName(),
    board: $("fBoard").value,
    title,
    price,
    location: $("fLocation").value.trim(),
    desc: $("fDesc").value.trim(),
    contact: $("fContact").value.trim(),
    status: $("fStatus").value,
    photoURL: "",
    createdAtMs: Date.now(),
    replies: [],
    lastReplyAtMs: 0,
    lastReplyBy: ""
  });

  // Upload image (optional)
  try{
    const file = $("fPhoto").files && $("fPhoto").files[0];
    if (file){
      const url = await uploadPhotoIfAny(file, docRef.id);
      if (url){
        await updateDoc(doc(db, "listings", docRef.id), { photoURL: url });
      }
    }
  }catch(e){
    console.error(e);
    $("postWarn").style.display = "block";
    $("postWarn").textContent = e.message || "Photo upload failed.";
    return;
  }

  hide("postOverlay");
  clearPostForm();
}

function openThread(id){
  openThreadId = id;
  $("replyText").value = "";
  $("replyOk").style.display = "none";
  $("replyWarn").style.display = "none";
  $("threadReplies").innerHTML = "";
  show("threadOverlay");

  if (openThreadUnsub) { openThreadUnsub(); openThreadUnsub = null; }

  openThreadUnsub = onSnapshot(doc(db, "listings", id), (snap)=>{
    if (!snap.exists()){
      $("threadTitle").textContent = "Thread";
      $("threadMeta").textContent = "";
      $("threadBody").textContent = "This post was removed.";
      $("threadReplies").innerHTML = "";
      return;
    }
    const x = { id:snap.id, ...snap.data() };
    $("threadTitle").textContent = x.title || "Thread";
    $("threadMeta").textContent = `${catLabel(x.board)} • Posted by ${x.displayName || x.userEmail || "—"} • ${prettyTime(x.createdAtMs)}`;
    $("threadBody").innerHTML = `
      <div class="row" style="margin-bottom:8px">
        <div class="price">${esc(fmtPrice(x.price) || "—")}</div>
        <div class="pill">${esc(x.status || "ACTIVE")}</div>
      </div>
      <div>${esc(x.desc||"")}</div>
      ${x.photoURL ? `<div style="height:10px"></div><img src="${x.photoURL}" alt="" style="width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.10)"/>` : ""}
      <div style="height:10px"></div>
      <div class="note">Contact: <b>${esc(x.contact || "—")}</b>${x.location ? ` • Location: <b>${esc(x.location)}</b>` : ""}</div>
    `;

    const replies = Array.isArray(x.replies) ? x.replies : [];
    const wrap = $("threadReplies");
    wrap.innerHTML = "";
    if (replies.length === 0){
      wrap.innerHTML = `<div class="note">No replies yet. Be the first.</div>`;
      return;
    }
    for (const r of replies){
      const el = document.createElement("div");
      el.className = "reply";
      el.innerHTML = `
        <div class="replyTop">
          <div class="replyBy">${esc(r.by || "—")}</div>
          <div class="replyAt">${esc(prettyTime(r.atMs))}</div>
        </div>
        <div class="replyText">${esc(r.text || "")}</div>
      `;
      wrap.appendChild(el);
    }
  });
}

async function sendReply(){
  $("replyOk").style.display = "none";
  $("replyWarn").style.display = "none";

  const text = ($("replyText").value||"").trim();
  if (!text){
    $("replyWarn").style.display = "block";
    $("replyWarn").textContent = "Type a reply first.";
    return;
  }
  if (!openThreadId) return;

  try{
    const refDoc = doc(db, "listings", openThreadId);
    const snap = await getDoc(refDoc);
    if (!snap.exists()) return;
    const data = snap.data();
    const replies = Array.isArray(data.replies) ? data.replies : [];
    replies.push({ by: displayName(), uid: user.uid, atMs: Date.now(), text });
    await updateDoc(refDoc, {
      replies,
      lastReplyAtMs: Date.now(),
      lastReplyBy: displayName()
    });
    $("replyText").value = "";
    $("replyOk").style.display = "block";
    $("replyOk").textContent = "Reply posted.";
    // In-app notification for post owner (best-effort)
    if (data.uid && data.uid !== user.uid){
      const nref = doc(collection(db, "profiles", data.uid, "notifications"));
      await setDoc(nref, {
        type: "reply",
        postId: openThreadId,
        postTitle: data.title || "",
        from: displayName(),
        atMs: Date.now(),
        read: false
      });
    }
  }catch(e){
    console.error(e);
    $("replyWarn").style.display = "block";
    $("replyWarn").textContent = "Reply failed. Check Firestore rules / connection.";
  }
}

function renderNotifs(){
  const wrap = $("notifList");
  wrap.innerHTML = "";
  if (notifs.length === 0){
    wrap.innerHTML = `<div class="note">No notifications.</div>`;
    return;
  }
  for (const n of notifs){
    const el = document.createElement("div");
    el.className = "notifItem";
    el.innerHTML = `
      <strong>${esc(n.from || "Someone")} replied</strong>
      <div class="meta">${esc(n.postTitle || "Post")} • ${esc(prettyTime(n.atMs))}</div>
      <div style="height:8px"></div>
      <button class="btn mini" type="button" data-open="${esc(n.postId)}">Open Thread</button>
    `;
    el.querySelector("[data-open]").addEventListener("click", ()=>{
      hide("notifOverlay");
      openThread(n.postId);
    });
    wrap.appendChild(el);
  }
}

async function markNotifsRead(){
  if (!user) return;
  const qy = query(collection(db, "profiles", user.uid, "notifications"), where("read","==",false));
  const snap = await getDocs(qy);
  for (const d of snap.docs){
    await updateDoc(d.ref, { read:true });
  }
}

/* =========================
   Wire UI
========================= */
document.addEventListener("DOMContentLoaded", ()=>{
  $("tabLogin").addEventListener("click", ()=>showPane("login"));
  $("tabSignup").addEventListener("click", ()=>showPane("signup"));

  $("btnLogin").addEventListener("click", async ()=>{
    const email = $("loginEmail").value.trim();
    const pass = $("loginPassword").value.trim();
    if (!email || !pass) return alert("Enter email and password.");
    if (!isAllowedEmail(email)) return alert("Use your @regallakeland.com email.");
    try{
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      if (!cred.user.emailVerified){
        $("verifyNote").style.display = "block";
        $("btnResendVerify").style.display = "inline-flex";
        alert("Please verify your email. Check your inbox.");
        await signOut(auth);
        return;
      }
    }catch(e){
      console.error(e);
      alert("Login failed. Check email/password.");
    }
  });

  $("btnResendVerify").addEventListener("click", async ()=>{
    const email = $("loginEmail").value.trim();
    const pass = $("loginPassword").value.trim();
    if (!email || !pass) return alert("Enter your email + password, then click Resend.");
    try{
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await sendEmailVerification(cred.user);
      alert("Verification email sent. Check your inbox (and spam).");
      await signOut(auth);
    }catch(e){
      console.error(e);
      alert("Could not resend verification. Double-check email/password.");
    }
  });

  $("btnSignup").addEventListener("click", async ()=>{
    const email = $("signupEmail").value.trim();
    const p1 = $("signupPassword").value.trim();
    const p2 = $("signupPassword2").value.trim();
    $("signupMsg").style.display = "none";
    if (!email || !p1 || !p2) return alert("Fill out email and both password boxes.");
    if (!isAllowedEmail(email)) return alert("Use your @regallakeland.com email.");
    if (p1.length < 8) return alert("Password must be at least 8 characters.");
    if (p1 !== p2) return alert("Passwords do not match.");
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, p1);
      await sendEmailVerification(cred.user);
      $("signupMsg").style.display = "block";
      $("signupMsg").textContent = "Account created! Verification email sent. Verify your email, then return to Login.";
      alert("Account created. Verify your email before logging in.");
      await signOut(auth);
      showPane("login");
      $("loginEmail").value = email;
      $("loginPassword").value = "";
      $("verifyNote").style.display = "block";
      $("btnResendVerify").style.display = "inline-flex";
    }catch(e){
      console.error(e);
      alert(e?.message || "Signup failed.");
    }
  });

  $("btnSaveProfile").addEventListener("click", saveProfileSetup);

  $("btnLogout").addEventListener("click", async ()=>{
    await signOut(auth);
  });

  $("btnNewPost").addEventListener("click", ()=>{
    if (!user) return show("authOverlay");
    show("postOverlay");
  });
  $("btnClosePost").addEventListener("click", ()=> hide("postOverlay"));
  $("btnSavePost").addEventListener("click", createPost);

  $("btnCloseThread").addEventListener("click", ()=> hide("threadOverlay"));
  $("btnSendReply").addEventListener("click", sendReply);

  $("btnNotif").addEventListener("click", async ()=>{
    show("notifOverlay");
    renderNotifs();
    await markNotifsRead();
  });
  $("btnCloseNotif").addEventListener("click", ()=> hide("notifOverlay"));

  ["q","st","sort"].forEach(id => $(id).addEventListener("input", render));

  // Card click actions
  $("cards").addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const id = btn.getAttribute("data-id");
    if (act === "thread") openThread(id);
  });
});

/* =========================
   Auth + Realtime
========================= */
onAuthStateChanged(auth, async (u)=>{
  user = u;
  if (!user){
    // logged out
    isAdmin = false;
    profile = null;
    $("pillUser").textContent = "Not signed in";
    $("btnLogout").style.display = "none";
    $("adminLink").style.display = "none";
    showPane("login");
    show("authOverlay");
    return;
  }

  // Block if email not verified (extra safety)
  if (!user.emailVerified){
    alert("Please verify your email before using the marketplace.");
    await signOut(auth);
    show("authOverlay");
    return;
  }

  isAdmin = ADMIN_EMAILS.has(String(user.email||"").toLowerCase());
  $("adminLink").style.display = isAdmin ? "inline-flex" : "none";
  $("btnLogout").style.display = "inline-flex";

  await upsertProfile({}); // update lastSeen
  const ok = await requireProfileSetup();
  if (!ok){
    // still allow listeners but keep overlay on
  } else {
    hide("profileOverlay");
  }

  $("pillUser").textContent = `Signed in: ${displayName()}`;
  hide("authOverlay");

  // Presence heartbeat
  setInterval(async ()=>{ try{ await upsertProfile({}); }catch{} }, 60_000);

  // Listings listener
  const qy = query(collection(db, "listings"), orderBy("createdAtMs", "desc"));
  onSnapshot(qy, async (snap)=>{
    // refresh profile to enforce bans
    try{
      await loadProfile();
      if (profile?.banned){
        alert("Access removed by admin.");
        await signOut(auth);
        show("authOverlay");
        return;
      }
    }catch{}
    listings = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderBoards();
    render();
  });

  // Notifications listener
  const nqy = query(collection(db, "profiles", user.uid, "notifications"), orderBy("atMs","desc"));
  onSnapshot(nqy, (snap)=>{
    notifs = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    const unread = notifs.some(n=>n.read === false);
    $("notifDot").style.display = unread ? "inline-block" : "none";
  });
});
