
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
  addDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/**
 * IMPORTANT:
 * This uses YOUR existing Firebase config you pasted earlier.
 * Keep these values as-is unless you changed them in Firebase.
 */
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
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
const show = (id) => { $(id).style.display = "flex"; };
const hide = (id) => { $(id).style.display = "none"; };
const esc = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

let user = null;
let isAdmin = false;
let listings = [];
let activeBoard = "ALL";
let openThreadId = null;

// Board defs
const BOARD_DEFS = [
  { key:"ALL", name:"All", desc:"Everything in one place" },
  { key:"FREE", name:"Free Items", desc:"Giveaways • curb alerts" },
  { key:"BUYSELL", name:"Buy / Sell", desc:"Items for sale" },
  { key:"GARAGE", name:"Garage Sales", desc:"Yard sales • moving sales" },
  { key:"EVENTS", name:"Events", desc:"BBQ • meetups • birthdays" },
  { key:"WORK", name:"Work News", desc:"Updates • announcements" },
  { key:"SERVICES", name:"Local Services", desc:"Side work • help needed" },
];

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
function prettyTime(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : (typeof ts === "number" ? new Date(ts) : null);
    if (!d) return "—";
    return d.toLocaleString();
  }catch{ return "—";}
}

function countByBoard(list){
  const map = { ALL: list.length };
  for (const b of BOARD_DEFS) map[b.key] = 0;
  for (const x of list){
    if (x.category && map[x.category] !== undefined) map[x.category]++;
  }
  map.ALL = list.length;
  return map;
}

function setActiveBoard(key){
  activeBoard = key;
  const def = BOARD_DEFS.find(b=>b.key===key) || BOARD_DEFS[0];
  $("boardPill").textContent = def.name;
  $("feedTitle").textContent = def.key === "ALL" ? "Marketplace" : def.name;

  // toggle active classes
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
    btn.type = "button";
    btn.className = "boardBtn";
    btn.dataset.key = b.key;
    btn.innerHTML = `
      <div>
        <div style="font-weight:950">${esc(b.name)}</div>
        <div class="boardDesc">${esc(b.desc)}</div>
      </div>
      <div class="boardCount">${counts[b.key] ?? 0}</div>
    `;
    btn.addEventListener("click", ()=> setActiveBoard(b.key));
    wrap.appendChild(btn);
  }

  setActiveBoard(activeBoard || "ALL");
}

function applyFilters(list){
  const q = ($("q").value || "").trim().toLowerCase();
  const st = $("st").value;
  const sort = $("sort").value;

  let out = list.slice();

  if (activeBoard !== "ALL") out = out.filter(x => x.category === activeBoard);

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
    const isFree = priceText === "FREE" || x.category === "FREE" || Number(x.price) === 0;
    const badgeClass = x.status === "SOLD" ? "sold" : (isFree ? "free" : "");

    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = x.id;

    el.innerHTML = `
      <div class="thumb">
        ${x.photo ? `<img src="${x.photo}" alt="">` : `<div style="color:rgba(156,163,175,.85);font-weight:950;font-size:12px">No photo</div>`}
        <div class="badge ${badgeClass}">${x.status==="SOLD" ? "SOLD" : (isFree ? "FREE" : "AVAILABLE")}</div>
      </div>

      <div class="card-b">
        <div class="row">
          <div class="name">${esc(x.title)}</div>
          <div class="price">${esc(priceText || "—")}</div>
        </div>
        <div class="meta">${esc(catLabel(x.category))}${x.location ? ` • ${esc(x.location)}` : ""}</div>
        <div class="desc">${esc(x.desc||"").slice(0, 220)}${(x.desc||"").length>220 ? "…" : ""}</div>
      </div>

      <div class="card-f">
        <span class="tag">${x.contact ? `Contact: ${esc(x.contact)}` : "No contact listed"}</span>
        <span class="tag">By: ${esc(x.displayName || x.userEmail || "—")}</span>
        <button class="btn mini" data-action="openThread">Open Thread</button>
        ${isAdmin ? `<button class="btn mini danger" data-action="deletePost">Admin Delete</button>` : ""}
      </div>
    `;

    cards.appendChild(el);
  }
}

/** THREAD VIEW */
async function openThread(id){
  const item = listings.find(x => x.id === id);
  if (!item) return;

  openThreadId = id;
  $("threadTitle").textContent = item.title || "Thread";
  $("threadMeta").textContent = `${catLabel(item.category)} • Posted by ${item.displayName || item.userEmail || "—"} • ${prettyTime(item.createdAt)}`;
  $("threadBody").innerHTML = `
    <div style="display:grid;gap:10px">
      ${item.photo ? `<img src="${item.photo}" style="width:100%;max-height:360px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,.10)">` : ""}
      <div>${esc(item.desc || "")}</div>
      <div class="meta">${item.location ? `Location: ${esc(item.location)} • ` : ""}${item.contact ? `Contact: ${esc(item.contact)}` : ""}</div>
    </div>
  `;

  renderReplies(item.replies || []);
  $("replyText").value = "";
  show("threadOverlay");
}

function renderReplies(replies){
  const wrap = $("threadReplies");
  wrap.innerHTML = "";
  if (!replies || replies.length === 0){
    wrap.innerHTML = `<div class="note">No replies yet. Be the first to respond.</div>`;
    return;
  }
  for (const r of replies){
    const div = document.createElement("div");
    div.className = "replyItem";
    div.innerHTML = `
      <div class="replyTop">
        <div class="replyUser">${esc(r.displayName || r.userEmail || "—")}</div>
        <div class="replyTime">${esc(prettyTime(r.createdAt))}</div>
      </div>
      <div class="replyText">${esc(r.text || "")}</div>
    `;
    wrap.appendChild(div);
  }
}

/** Upload image -> download URL */
async function uploadImageToStorage(file){
  const path = `listingPhotos/${user.uid}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

async function createPost(){
  const title = $("fTitle").value.trim();
  if (!title) return alert("Enter a title.");

  const priceRaw = $("fPrice").value.trim();
  let price = "";
  if (priceRaw !== ""){
    const n = Number(priceRaw);
    if (!Number.isFinite(n) || n < 0) return alert("Price must be 0 or more.");
    price = n;
  }

  let photoUrl = "";
  const file = $("fPhoto").files?.[0];
  if (file){
    if (!file.type.startsWith("image/")) return alert("Select an image file.");
    photoUrl = await uploadImageToStorage(file);
  }

  await addDoc(collection(db, "listings"), {
    uid: user.uid,
    userEmail: user.email,
    displayName: user.email.split("@")[0],
    category: $("fBoard").value,
    status: $("fStatus").value,
    title,
    price,
    location: $("fLocation").value.trim(),
    desc: $("fDesc").value.trim(),
    contact: $("fContact").value.trim(),
    photo: photoUrl,
    replies: [],
    createdAt: serverTimestamp(),
    createdAtMs: Date.now()
  });

  // reset
  $("fTitle").value = "";
  $("fPrice").value = "";
  $("fLocation").value = "";
  $("fDesc").value = "";
  $("fContact").value = "";
  $("fPhoto").value = "";
  $("fStatus").value = "ACTIVE";
  $("fBoard").value = "FREE";

  hide("postOverlay");
}

async function sendReply(){
  if (!openThreadId) return;
  const txt = $("replyText").value.trim();
  if (!txt) return;

  const refDoc = doc(db, "listings", openThreadId);
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return alert("Post not found.");

  const data = snap.data();
  const replies = Array.isArray(data.replies) ? data.replies.slice() : [];
  replies.push({
    userEmail: user.email,
    displayName: user.email.split("@")[0],
    text: txt,
    createdAt: serverTimestamp()
  });

  await updateDoc(refDoc, { replies });
  $("replyText").value = "";
}

async function adminDelete(id){
  if (!isAdmin) return alert("Admin only.");
  if (!confirm("Admin delete this post?")) return;
  await deleteDoc(doc(db, "listings", id));
  // close thread if open
  if (openThreadId === id){
    openThreadId = null;
    hide("threadOverlay");
  }
}

// UI wiring
$("btnLogin").addEventListener("click", async ()=>{
  const email = $("loginEmail").value.trim();
  const pass = $("loginPassword").value.trim();
  if (!email || !pass) return alert("Enter email and password.");
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    alert("Login failed. Check email/password.");
  }
});

$("btnLogout").addEventListener("click", async ()=>{
  await signOut(auth);
  location.reload();
});

$("btnNew").addEventListener("click", ()=> show("postOverlay"));
$("btnSavePost").addEventListener("click", ()=> createPost());
$("btnSendReply").addEventListener("click", ()=> sendReply());

document.body.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-close]");
  if (btn){
    hide(btn.dataset.close);
    return;
  }

  const actionBtn = e.target.closest("[data-action]");
  if (!actionBtn) return;

  const action = actionBtn.dataset.action;
  const card = actionBtn.closest(".card");
  const id = card?.dataset?.id;
  if (!id) return;

  if (action === "openThread") openThread(id);
  if (action === "deletePost") adminDelete(id);
});

["q","st","sort"].forEach(id => $(id).addEventListener("input", render));

// Auth + realtime listener
onAuthStateChanged(auth, (u)=>{
  user = u;
  if (!user){
    $("pillUser").textContent = "Not signed in";
    show("loginOverlay");
    return;
  }

  hide("loginOverlay");
  $("pillUser").textContent = `Signed in: ${user.email}`;
  isAdmin = ADMINS.has(user.email.toLowerCase());
  $("adminLink").style.display = isAdmin ? "inline-flex" : "none";

  // realtime listings
  const qy = query(collection(db, "listings"), orderBy("createdAtMs", "desc"));
  onSnapshot(qy, (snap)=>{
    listings = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderBoards();
    render();

    // keep thread modal updated live if open
    if (openThreadId){
      const item = listings.find(x=>x.id===openThreadId);
      if (item){
        renderReplies(item.replies || []);
      }
    }
  });
});
