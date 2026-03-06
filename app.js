
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, getDoc, doc, updateDoc, deleteDoc, setDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const cfg = window.FIREBASE_CONFIG || {};
const adminEmails = new Set((window.ADMIN_EMAILS || []).map(x => String(x).toLowerCase()));
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const domainOk = (email)=>String(email||"").toLowerCase().endsWith("@regallakeland.com");
const BOARDS = [
  {key:"ALL", name:"All", desc:"Everything in one place"},
  {key:"FREE", name:"Free Items", desc:"Giveaways • curb alerts"},
  {key:"BUYSELL", name:"Buy / Sell", desc:"Items for sale"},
  {key:"GARAGE", name:"Garage Sales", desc:"Yard sales • moving sales"},
  {key:"EVENTS", name:"Events", desc:"BBQ • meetups • birthdays"},
  {key:"WORK", name:"Work News", desc:"Updates • announcements"},
  {key:"SERVICES", name:"Local Services", desc:"Side work • help needed"}
];

let user = null;
let profile = null;
let listings = [];
let notifications = [];
let activeBoard = "ALL";
let editingId = null;
let openThreadId = null;
let threadUnsub = null;

function show(id){ $(id).style.display = "flex"; }
function hide(id){ $(id).style.display = "none"; }
function setWarn(id, msg=""){ const el=$(id); el.style.display=msg?"block":"none"; el.textContent=msg; }
function setOk(id, msg=""){ const el=$(id); el.style.display=msg?"block":"none"; el.textContent=msg; }
function prettyTime(ms){ return ms ? new Date(ms).toLocaleString() : "—"; }
function fmtPrice(v){ const n=Number(v); if(!Number.isFinite(n) || n<=0.01) return "FREE"; return "$"+n.toFixed(n%1===0?0:2); }
function displayName(){ return (profile?.name || (user?.email || "").split("@")[0] || "Employee").trim(); }
function isAdmin(){ return adminEmails.has(String(user?.email||"").toLowerCase()); }
function canMarkSold(item){ return item.board !== "FREE" && Number(item.price) > 0.01; }

async function loadProfile(){
  if(!user) return null;
  const snap = await getDoc(doc(db, "profiles", user.uid));
  profile = snap.exists() ? snap.data() : null;
  return profile;
}
async function saveProfile(data){
  await setDoc(doc(db, "profiles", user.uid), { uid:user.uid, email:user.email, lastSeenAtMs:Date.now(), ...data }, {merge:true});
  await loadProfile();
}

function renderBoards(){
  const counts = {ALL:0, FREE:0, BUYSELL:0, GARAGE:0, EVENTS:0, WORK:0, SERVICES:0};
  listings.forEach(x=>{ counts.ALL += 1; if(counts[x.board] !== undefined) counts[x.board] += 1; });
  const wrap = $("boards");
  wrap.innerHTML = "";
  BOARDS.forEach(b=>{
    const btn = document.createElement("button");
    btn.className = "boardBtn" + (activeBoard===b.key ? " active" : "");
    btn.innerHTML = `<div class="boardLeft"><div class="boardName">${esc(b.name)}</div><div class="boardDesc">${esc(b.desc)}</div></div><div class="boardCount">${counts[b.key] || 0}</div>`;
    btn.onclick = ()=>{ activeBoard=b.key; $("boardPill").textContent=b.name; $("marketTitle").textContent=b.key==="ALL"?"Marketplace":b.name; renderBoards(); renderListings(); };
    wrap.appendChild(btn);
  });
}
function filteredListings(){
  const q = $("q").value.trim().toLowerCase();
  const st = $("st").value;
  const sort = $("sort").value;
  let arr = listings.slice();
  if(activeBoard !== "ALL") arr = arr.filter(x=>x.board===activeBoard);
  if(st==="ACTIVE") arr = arr.filter(x=>x.status!=="SOLD");
  if(st==="SOLD") arr = arr.filter(x=>x.status==="SOLD");
  if(q) arr = arr.filter(x => `${x.title} ${x.desc} ${x.location} ${x.contact} ${x.displayName}`.toLowerCase().includes(q));
  if(sort==="PINNED_NEW") arr.sort((a,b)=>(Number(b.pinned||0)-Number(a.pinned||0)) || ((b.createdAtMs||0)-(a.createdAtMs||0)));
  if(sort==="NEW") arr.sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
  if(sort==="OLD") arr.sort((a,b)=>(a.createdAtMs||0)-(b.createdAtMs||0));
  if(sort==="PRICE_ASC") arr.sort((a,b)=>(Number(a.price)||0)-(Number(b.price)||0));
  if(sort==="PRICE_DESC") arr.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0));
  return arr;
}
function renderListings(){
  const arr = filteredListings();
  $("countLine").textContent = `${arr.length} shown • ${listings.length} total`;
  $("empty").style.display = arr.length ? "none" : "block";
  $("cards").innerHTML = "";
  arr.forEach(item=>{
    const mine = user && item.uid === user.uid;
    const sold = item.status === "SOLD";
    const badgeClass = sold ? "sold" : (item.board==="FREE" || Number(item.price)<=0.01 ? "free" : "");
    const photos = Array.isArray(item.photoURLs) ? item.photoURLs : (item.photoURL ? [item.photoURL] : []);
    const thumb = photos[0] || "";
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="thumb">
        ${thumb ? `<img src="${thumb}" alt="">` : `<div style="color:#94a3b8;padding:14px;font-weight:700;font-size:12px">No photo</div>`}
        <div class="badge ${badgeClass}">${sold ? "SOLD" : ((item.board==="FREE" || Number(item.price)<=0.01) ? "FREE" : "AVAILABLE")}</div>
        ${item.pinned ? `<div class="badge pinned">Pinned</div>` : ""}
        ${photos.length > 1 ? `<div class="thumbCount">${photos.length} photos</div>` : ""}
      </div>
      <div class="card-b">
        <div class="row"><div class="name">${esc(item.title)}</div><div class="price">${esc(fmtPrice(item.price))}</div></div>
        <div class="meta">${esc(item.board)}${item.location ? ` • ${esc(item.location)}` : ""}</div>
        <div class="desc">${esc(item.desc || "")}</div>
      </div>
      <div class="card-f">
        <span class="tag">By: ${esc(item.displayName || item.userEmail || "—")}</span>
        <span class="tag">${item.contact ? `Contact: ${esc(item.contact)}` : "No contact listed"}</span>
        <button class="btn mini" data-act="thread" data-id="${esc(item.id)}" type="button">Open Thread</button>
        ${mine ? `<button class="btn mini" data-act="edit" data-id="${esc(item.id)}" type="button">Edit</button>` : ""}
        ${mine ? `<button class="btn mini danger" data-act="delete" data-id="${esc(item.id)}" type="button">Delete</button>` : ""}
        ${mine && canMarkSold(item) ? `<button class="btn mini" data-act="sold" data-id="${esc(item.id)}" type="button">${sold ? "Mark Active" : "Mark Sold"}</button>` : ""}
        ${isAdmin() ? `<button class="btn mini" data-act="pin" data-id="${esc(item.id)}" type="button">${item.pinned ? "Unpin" : "Pin"}</button>` : ""}
        ${isAdmin() ? `<button class="btn mini danger" data-act="admindelete" data-id="${esc(item.id)}" type="button">Admin Delete</button>` : ""}
      </div>`;
    $("cards").appendChild(el);
  });
}

function renderNotifications(){
  $("notifList").innerHTML = notifications.length ? "" : `<div class="note">No notifications.</div>`;
  notifications.forEach(n=>{
    const div = document.createElement("div");
    div.className = "note";
    div.style.marginBottom = "10px";
    div.innerHTML = `<strong>${esc(n.title || "Notification")}</strong><div style="margin-top:6px">${esc(n.text || "")}</div><div style="margin-top:6px;color:#9ca3af">${esc(prettyTime(n.createdAtMs))}</div>`;
    $("notifList").appendChild(div);
  });
  $("notifCount").textContent = String(notifications.filter(x=>!x.read).length);
}

function toggleBoardPriceUI(){
  const isFree = $("fBoard").value === "FREE";
  $("priceField").style.display = isFree ? "none" : "flex";
  if(isFree) $("fPrice").value = "";
}
function clearPostForm(){
  editingId = null;
  $("postModalTitle").textContent = "Create Post";
  $("btnSavePost").textContent = "Save Post";
  $("fBoard").value = "FREE";
  $("fStatus").value = "ACTIVE";
  $("fTitle").value = "";
  $("fPrice").value = "";
  $("fLocation").value = "";
  $("fDesc").value = "";
  $("fContact").value = "";
  $("fPhotos").value = "";
  toggleBoardPriceUI();
  setWarn("postWarn"); setOk("postOk");
}
async function uploadPhotos(files, id){
  const out = [];
  for(const file of files){
    const ref = sRef(storage, `postPhotos/${id}/${Date.now()}_${file.name}`);
    await uploadBytes(ref, file);
    out.push(await getDownloadURL(ref));
  }
  return out;
}
async function savePost(){
  setWarn("postWarn"); setOk("postOk");
  $("btnSavePost").disabled = true;
  try{
    const board = $("fBoard").value;
    const title = $("fTitle").value.trim();
    const desc = $("fDesc").value.trim();
    const contact = $("fContact").value.trim();
    const location = $("fLocation").value.trim();
    const status = $("fStatus").value;
    const files = [...($("fPhotos").files || [])];
    if(files.length > 10) throw new Error("Maximum 10 images per post.");
    if(!title) throw new Error("Title is required.");
    if(!contact) throw new Error("Contact is required.");
    let price = 0;
    if(board !== "FREE"){
      const n = Number($("fPrice").value);
      if(!Number.isFinite(n) || n < 0.01) throw new Error("Please enter an amount over 0.01 for sale items.");
      price = n;
    }

    if(editingId){
      const original = listings.find(x=>x.id===editingId);
      if(!original) throw new Error("Could not find the post you are editing.");
      let photoURLs = Array.isArray(original.photoURLs) ? original.photoURLs : (original.photoURL ? [original.photoURL] : []);
      if(files.length){
        try{
          photoURLs = await uploadPhotos(files, editingId);
        }catch(e){
          const keepGoing = confirm("Photo upload failed. Save post without replacing photos?");
          if(!keepGoing) throw e;
        }
      }
      await updateDoc(doc(db, "listings", editingId), {
        board, status, title, desc, contact, location, price, photoURLs,
        photoURL: photoURLs[0] || "",
        displayName: displayName(), editedAtMs: Date.now()
      });
      setOk("postOk", "Post updated.");
    }else{
      const docRef = await addDoc(collection(db, "listings"), {
        uid:user.uid, userEmail:user.email, displayName:displayName(),
        board, status, title, desc, contact, location, price,
        photoURLs: [], photoURL:"", replies:[], reports:[],
        pinned:false, createdAtMs:Date.now(), editedAtMs:0
      });
      if(files.length){
        try{
          const photoURLs = await uploadPhotos(files, docRef.id);
          await updateDoc(doc(db, "listings", docRef.id), { photoURLs, photoURL: photoURLs[0] || "" });
          setOk("postOk", "Post saved with photos.");
        }catch(e){
          if(confirm("Photo upload failed. Save the post without the photos?")){
            setOk("postOk", "Post saved without photos.");
          }else{
            await deleteDoc(doc(db, "listings", docRef.id));
            throw e;
          }
        }
      }else{
        setOk("postOk", "Post saved.");
      }
    }
    setTimeout(()=>{ hide("postOverlay"); clearPostForm(); }, 700);
  }catch(e){
    console.error(e);
    setWarn("postWarn", e.message || "Post failed to save.");
  }finally{
    $("btnSavePost").disabled = false;
  }
}

function fillEditForm(item){
  editingId = item.id;
  $("postModalTitle").textContent = "Edit Post";
  $("btnSavePost").textContent = "Update Post";
  $("fBoard").value = item.board || "FREE";
  $("fStatus").value = item.status || "ACTIVE";
  $("fTitle").value = item.title || "";
  $("fPrice").value = item.board === "FREE" ? "" : (item.price ?? "");
  $("fLocation").value = item.location || "";
  $("fDesc").value = item.desc || "";
  $("fContact").value = item.contact || "";
  $("fPhotos").value = "";
  toggleBoardPriceUI();
  setWarn("postWarn"); setOk("postOk");
  show("postOverlay");
}

function openThread(id){
  openThreadId = id;
  show("threadOverlay");
  setWarn("replyWarn"); setOk("replyOk"); $("replyText").value = "";
  if(threadUnsub){ threadUnsub(); threadUnsub = null; }
  threadUnsub = onSnapshot(doc(db, "listings", id), snap=>{
    if(!snap.exists()){
      $("threadTitle").textContent = "Thread";
      $("threadBody").textContent = "This post was removed.";
      $("threadReplies").innerHTML = "";
      return;
    }
    const item = {id:snap.id, ...snap.data()};
    const photos = Array.isArray(item.photoURLs) ? item.photoURLs : (item.photoURL ? [item.photoURL] : []);
    $("threadTitle").textContent = item.title || "Thread";
    $("threadMeta").textContent = `${esc(item.board)} • Posted by ${esc(item.displayName || item.userEmail || "—")} • ${prettyTime(item.createdAtMs)}`;
    $("threadGallery").innerHTML = photos.map(url => `<img src="${url}" alt="">`).join("");
    $("threadBody").innerHTML = `
      <div class="row" style="margin-bottom:8px"><div class="price">${esc(fmtPrice(item.price))}</div><div class="pill">${esc(item.status || "ACTIVE")}</div></div>
      <div>${esc(item.desc || "")}</div>
      <div style="height:10px"></div>
      <div class="note">Contact: <b>${esc(item.contact || "—")}</b>${item.location ? ` • Location: <b>${esc(item.location)}</b>` : ""}</div>`;
    const contactHref = item.contact && /^\+?[0-9()\-.\s]+$/.test(item.contact) ? `tel:${item.contact}` : (item.contact ? `mailto:${item.contact}` : "#");
    $("btnContactSeller").style.display = item.contact ? "inline-flex" : "none";
    $("btnContactSeller").href = contactHref;
    const replies = item.replies || [];
    $("threadReplies").innerHTML = replies.length ? "" : `<div class="note">No replies yet. Be the first.</div>`;
    replies.forEach(r=>{
      const div = document.createElement("div");
      div.className = "reply";
      div.innerHTML = `<div class="replyTop"><div class="replyBy">${esc(r.by || "—")}</div><div class="replyAt">${esc(prettyTime(r.atMs))}</div></div><div class="replyText">${esc(r.text || "")}</div>`;
      $("threadReplies").appendChild(div);
    });
  });
}
async function sendReply(){
  setWarn("replyWarn"); setOk("replyOk");
  try{
    const text = $("replyText").value.trim();
    if(!text) throw new Error("Type a reply first.");
    const ref = doc(db, "listings", openThreadId);
    const snap = await getDoc(ref);
    if(!snap.exists()) throw new Error("Post not found.");
    const data = snap.data();
    const replies = Array.isArray(data.replies) ? data.replies : [];
    replies.push({ by:displayName(), uid:user.uid, text, atMs:Date.now() });
    await updateDoc(ref, { replies });
    $("replyText").value = "";
    setOk("replyOk", "Reply posted.");

    if(data.uid && data.uid !== user.uid){
      const notif = {
        title: "New reply",
        text: `${displayName()} replied to: ${data.title || "your post"}`,
        createdAtMs: Date.now(),
        read: false
      };
      await addDoc(collection(db, "profiles", data.uid, "notifications"), notif);
    }
  }catch(e){
    console.error(e);
    setWarn("replyWarn", e.message || "Reply failed.");
  }
}
async function reportCurrentPost(){
  try{
    const ref = doc(db, "listings", openThreadId);
    const snap = await getDoc(ref);
    if(!snap.exists()) throw new Error("Post not found.");
    const data = snap.data();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    reports.push({ by: displayName(), uid: user.uid, atMs: Date.now() });
    await updateDoc(ref, { reports });
    alert("Post reported.");
  }catch(e){
    console.error(e);
    alert("Could not report the post.");
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("tabLogin").onclick = ()=>{ $("loginPane").style.display="block"; $("signupPane").style.display="none"; $("tabLogin").classList.add("active"); $("tabSignup").classList.remove("active"); };
  $("tabSignup").onclick = ()=>{ $("loginPane").style.display="none"; $("signupPane").style.display="block"; $("tabSignup").classList.add("active"); $("tabLogin").classList.remove("active"); };

  $("btnLogin").onclick = async ()=>{
    try{
      setWarn("authWarn");
      const email = $("loginEmail").value.trim();
      const pw = $("loginPassword").value.trim();
      if(!domainOk(email)) throw new Error("Use your @regallakeland.com email.");
      await signInWithEmailAndPassword(auth, email, pw);
    }catch(e){
      console.error(e);
      setWarn("authWarn", e.message || "Login failed.");
    }
  };

  $("btnForgotPassword").onclick = async ()=>{
    try{
      const email = $("loginEmail").value.trim();
      if(!domainOk(email)) throw new Error("Enter your @regallakeland.com email first.");
      await sendPasswordResetEmail(auth, email);
      setWarn("authWarn", "Password reset email sent.");
    }catch(e){
      console.error(e);
      setWarn("authWarn", e.message || "Password reset failed.");
    }
  };

  $("btnSignup").onclick = async ()=>{
    try{
      setWarn("signupMsg");
      const name = $("signupName").value.trim();
      const email = $("signupEmail").value.trim();
      const p1 = $("signupPassword").value.trim();
      const p2 = $("signupPassword2").value.trim();
      if(!name) throw new Error("Enter first and last name.");
      if(!domainOk(email)) throw new Error("Use your @regallakeland.com email.");
      if(p1.length < 8) throw new Error("Password must be at least 8 characters.");
      if(p1 !== p2) throw new Error("Passwords do not match.");
      if(!$("agreeRules").checked) throw new Error("You must agree to the rules.");
      const cred = await createUserWithEmailAndPassword(auth, email, p1);
      await sendEmailVerification(cred.user);
      await setDoc(doc(db, "profiles", cred.user.uid), { uid:cred.user.uid, email, name, agreedRules:true, createdAtMs:Date.now(), lastSeenAtMs:Date.now(), banned:false }, {merge:true});
      await signOut(auth);
      $("tabLogin").click();
      $("loginEmail").value = email;
      setWarn("authWarn", "Account created. Check your email for the verification link, then log in.");
    }catch(e){
      console.error(e);
      setWarn("signupMsg", e.message || "Create account failed.");
    }
  };

  $("btnNewPost").onclick = ()=>{ clearPostForm(); show("postOverlay"); };
  $("btnClosePost").onclick = ()=>{ hide("postOverlay"); clearPostForm(); };
  $("btnSavePost").onclick = savePost;
  $("fBoard").onchange = toggleBoardPriceUI;
  $("btnCloseThread").onclick = ()=>{ hide("threadOverlay"); };
  $("btnSendReply").onclick = sendReply;
  $("btnReportPost").onclick = reportCurrentPost;
  $("btnLogout").onclick = async ()=>{ await signOut(auth); };
  $("btnNotifications").onclick = ()=>{ renderNotifications(); show("notifOverlay"); };
  $("btnCloseNotifications").onclick = ()=>{ hide("notifOverlay"); };

  ["q","st","sort"].forEach(id=>$(id).addEventListener("input", renderListings));

  $("cards").addEventListener("click", async (e)=>{
    const btn = e.target.closest("[data-act]");
    if(!btn) return;
    const id = btn.dataset.id;
    const item = listings.find(x=>x.id===id);
    if(!item) return;
    if(btn.dataset.act === "thread") openThread(id);
    if(btn.dataset.act === "edit") fillEditForm(item);
    if(btn.dataset.act === "delete"){ if(confirm("Delete this post?")) await deleteDoc(doc(db,"listings",id)); }
    if(btn.dataset.act === "sold"){ await updateDoc(doc(db,"listings",id), { status:item.status==="SOLD" ? "ACTIVE" : "SOLD" }); }
    if(btn.dataset.act === "pin" && isAdmin()){ await updateDoc(doc(db,"listings",id), { pinned: !item.pinned }); }
    if(btn.dataset.act === "admindelete" && isAdmin()){ if(confirm("Admin delete this post?")) await deleteDoc(doc(db,"listings",id)); }
  });
});

onAuthStateChanged(auth, async (u)=>{
  user = u;
  if(!u){
    $("userPill").textContent = "Not signed in";
    $("btnNewPost").style.display = "none";
    $("btnLogout").style.display = "none";
    $("btnNotifications").style.display = "none";
    $("adminLink").style.display = "none";
    show("authOverlay");
    return;
  }
  $("btnLogout").style.display = "inline-flex";
  if(!u.emailVerified){
    setWarn("authWarn", "Please verify your email before using the marketplace. Check your inbox.");
    show("authOverlay");
    return;
  }
  await loadProfile();
  if(!profile){
    await saveProfile({ name:(u.email||"").split("@")[0], banned:false });
  }
  if(profile?.banned){
    alert("Your access has been removed by an admin.");
    await signOut(auth);
    return;
  }
  $("userPill").textContent = `${displayName()}${isAdmin() ? " • Admin" : ""}`;
  $("btnNewPost").style.display = "inline-flex";
  $("btnLogout").style.display = "inline-flex";
  $("btnNotifications").style.display = "inline-flex";
  $("adminLink").style.display = isAdmin() ? "inline-flex" : "none";
  hide("authOverlay");
  await saveProfile({ name:displayName(), lastSeenAtMs:Date.now() });

  onSnapshot(query(collection(db, "listings"), orderBy("createdAtMs", "desc")), snap=>{
    listings = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderBoards();
    renderListings();
  });

  onSnapshot(query(collection(db, "profiles", u.uid, "notifications"), orderBy("createdAtMs", "desc")), snap=>{
    notifications = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderNotifications();
  });
});
