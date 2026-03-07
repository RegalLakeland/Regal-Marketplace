import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const boardLabels = {
  ALL: "All Boards",
  FREE: "Free Items",
  BUYSELL: "Buy / Sell",
  GARAGE: "Garage Sales",
  EVENTS: "Events",
  WORK: "Work News",
  SERVICES: "Local Services"
};

let currentUser = null;
let currentProfile = null;
let listings = [];
let activeBoard = "ALL";
let activeThread = null;
let listingsUnsub = null;
let repliesUnsub = null;
let lastUnverifiedEmail = "";

window.addEventListener("error", (e) => {
  console.error("Marketplace JS error:", e.error || e.message || e);
});

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  renderBoards();
  renderListings();

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        currentUser = null;
        currentProfile = null;
        stopListeners();
        updateAuthUI();
        return;
      }

      await user.reload().catch(() => {});
      if (!user.emailVerified) {
        lastUnverifiedEmail = user.email || "";
        if ($("verifyNote")) $("verifyNote").style.display = "block";
        if ($("btnResendVerify")) $("btnResendVerify").style.display = "inline-flex";
        await signOut(auth);
        alert("Please verify your email before logging in.");
        return;
      }

      currentUser = user;
      lastUnverifiedEmail = "";

      if ($("verifyNote")) $("verifyNote").style.display = "none";
      if ($("btnResendVerify")) $("btnResendVerify").style.display = "none";

      await ensureProfile(user);
      updateAuthUI();
      startListingsListener();

      if (!currentProfile?.displayName) {
        if ($("displayNameInput")) $("displayNameInput").value = user.displayName || "";
        show("nameOverlay");
      } else {
        hide("nameOverlay");
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || "Authentication error.");
    }
  });
});

function bindStaticEvents() {
  $("tabLogin")?.addEventListener("click", () => showPane("login"));
  $("tabSignup")?.addEventListener("click", () => showPane("signup"));

  $("btnLogin")?.addEventListener("click", handleLogin);
  $("btnSignup")?.addEventListener("click", handleSignup);
  $("btnResendVerify")?.addEventListener("click", handleResendVerification);
  $("btnSaveName")?.addEventListener("click", handleSaveName);
  $("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
  });

  $("btnNew")?.addEventListener("click", () => {
    if (!currentUser) {
      alert("Please log in first.");
      return;
    }
    show("postOverlay");
  });

  $("btnSavePost")?.addEventListener("click", handleSavePost);
  $("btnSendReply")?.addEventListener("click", handleSendReply);

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => hide(btn.dataset.close));
  });

  $("q")?.addEventListener("input", renderListings);
  $("st")?.addEventListener("change", renderListings);
  $("sort")?.addEventListener("change", renderListings);

  document.body.addEventListener("click", async (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (!id) return;

    if (action === "openThread") {
      await openThread(id);
    } else if (action === "deletePost") {
      await handleDeletePost(id);
    } else if (action === "markSold") {
      await handleMarkSold(id);
    }
  });
}

function showPane(which) {
  const loginPane = $("loginPane");
  const signupPane = $("signupPane");
  const tabLogin = $("tabLogin");
  const tabSignup = $("tabSignup");
  if (!loginPane || !signupPane || !tabLogin || !tabSignup) return;

  if (which === "login") {
    loginPane.style.display = "block";
    signupPane.style.display = "none";
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
  } else {
    loginPane.style.display = "none";
    signupPane.style.display = "block";
    tabSignup.classList.add("active");
    tabLogin.classList.remove("active");
  }
}

function show(id) {
  const el = $(id);
  if (el) el.style.display = "flex";
}

function hide(id) {
  const el = $(id);
  if (el) el.style.display = "none";
}

function isAllowedEmail(email) {
  return String(email || "").trim().toLowerCase().endsWith("@regallakeland.com");
}

function isAdmin(email) {
  return ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}

function stopListeners() {
  if (listingsUnsub) {
    listingsUnsub();
    listingsUnsub = null;
  }
  if (repliesUnsub) {
    repliesUnsub();
    repliesUnsub = null;
  }
  listings = [];
  activeThread = null;
  renderListings();
}

async function ensureProfile(user) {
  const profileRef = doc(db, "profiles", user.uid);
  const snap = await getDoc(profileRef);

  const baseProfile = {
    uid: user.uid,
    email: user.email || "",
    displayName: (user.displayName || "").trim(),
    isAdmin: isAdmin(user.email),
    updatedAt: serverTimestamp()
  };

  if (!snap.exists()) {
    await setDoc(profileRef, {
      ...baseProfile,
      createdAt: serverTimestamp()
    });
    currentProfile = {
      ...baseProfile,
      createdAt: new Date()
    };
  } else {
    currentProfile = { id: snap.id, ...snap.data() };
    if (currentProfile.isAdmin !== isAdmin(user.email)) {
      await updateDoc(profileRef, {
        isAdmin: isAdmin(user.email),
        updatedAt: serverTimestamp()
      });
      currentProfile.isAdmin = isAdmin(user.email);
    }
  }
}

function updateAuthUI() {
  const loggedIn = !!currentUser && !!currentProfile;

  if ($("pillUser")) {
    $("pillUser").textContent = loggedIn
      ? `${currentProfile.displayName || currentUser.email}`
      : "Not signed in";
  }

  if ($("adminLink")) $("adminLink").style.display = loggedIn && currentProfile.isAdmin ? "inline-flex" : "none";
  if ($("btnLogout")) $("btnLogout").style.display = loggedIn ? "inline-flex" : "none";
  if ($("btnNew")) $("btnNew").style.display = loggedIn ? "inline-flex" : "none";
  if ($("loginOverlay")) $("loginOverlay").style.display = loggedIn ? "none" : "flex";
}

async function handleLogin() {
  const email = $("loginEmail")?.value.trim().toLowerCase();
  const password = $("loginPassword")?.value || "";

  if (!email || !password) {
    alert("Enter email and password.");
    return;
  }
  if (!isAllowedEmail(email)) {
    alert("Use your @regallakeland.com email.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    alert(`${err?.code || "login_error"} — ${err?.message || "Login failed."}`);
  }
}

async function handleSignup() {
  const email = $("signupEmail")?.value.trim().toLowerCase();
  const password = $("signupPassword")?.value || "";
  const password2 = $("signupPassword2")?.value || "";
  const msg = $("signupMsg");

  if (msg) {
    msg.style.display = "none";
    msg.textContent = "";
  }

  if (!email || !password || !password2) {
    alert("Complete all signup fields.");
    return;
  }
  if (!isAllowedEmail(email)) {
    alert("Use your @regallakeland.com email.");
    return;
  }
  if (password.length < 6) {
    alert("Password must be at least 6 characters.");
    return;
  }
  if (password !== password2) {
    alert("Passwords do not match.");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user);
    await signOut(auth);

    if (msg) {
      msg.textContent = "Account created. Check your email and click the verification link, then log in.";
      msg.style.display = "block";
    }

    if ($("loginEmail")) $("loginEmail").value = email;
    if ($("loginPassword")) $("loginPassword").value = "";

    lastUnverifiedEmail = email;
    if ($("btnResendVerify")) $("btnResendVerify").style.display = "inline-flex";

    showPane("login");
    alert("Account created. Verification email sent.");
  } catch (err) {
    console.error(err);
    alert(`${err?.code || "signup_error"} — ${err?.message || "Signup failed."}`);
  }
}

async function handleResendVerification() {
  const email = (lastUnverifiedEmail || $("loginEmail")?.value || "").trim().toLowerCase();
  if (!email) {
    alert("Enter your email first.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    alert("Check your email. If your account exists, a message was sent. If you still need verification, sign in again after opening the verification email.");
  } catch (err) {
    console.error(err);
    alert(err?.message || "Unable to send email right now.");
  }
}

async function handleSaveName() {
  const name = $("displayNameInput")?.value.trim();
  if (!currentUser) {
    alert("Please log in again.");
    return;
  }
  if (!name) {
    alert("Enter your name.");
    return;
  }

  await updateDoc(doc(db, "profiles", currentUser.uid), {
    displayName: name,
    updatedAt: serverTimestamp()
  });

  currentProfile.displayName = name;
  updateAuthUI();
  hide("nameOverlay");
}

function startListingsListener() {
  if (listingsUnsub) return;

  const qRef = query(collection(db, "listings"), orderBy("createdAtMs", "desc"));
  listingsUnsub = onSnapshot(qRef, (snap) => {
    listings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBoards();
    renderListings();
  }, (err) => {
    console.error(err);
    alert(`Listings error: ${err?.message || err}`);
  });
}

function renderBoards() {
  const replies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      signupPane.style.display = "block";
      tabSignup.classList.add("active");
      tabLogin.classList.remove("active");
    }
  }}
  $("tabLogin")?.addEventListener("click", ()=>showPane("login"));
  $("tabSignup")?.addEventListener("click", ()=>showPane("signup"));

  function isAllowedEmail(email){
    const e = String(email||"").trim().toLowerCase();
    return e.endsWith("@regallakeland.com");
  }

  let user = null;
  let profile = null;
  let listings = [];
  let activeBoard = "ALL";
  let openThreadId = null;


  let listingsUnsub = null;

  function startListingsListener(){
    if (listingsUnsub) return;
    const qRef = query(collection(db, "listings"), orderBy("createdAtMs", "desc"));
    listingsUnsub = onSnapshot(qRef, (snap)=>{
      listings = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderBoards();
      render();
    }, (err)=>{
      console.error(err);
    });
  }

  function stopListingsListener(){
    if (listingsUnsub){
      listingsUnsub();
      listingsUnsub = null;
    }
    listings = [];
    renderBoards();
    render();
  }

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

  async function loadProfile(){
    const refDoc = doc(db, "profiles", user.uid);
    const snap = await getDoc(refDoc);
    profile = snap.exists() ? snap.data() : null;
    return profile;
  }

  async function upsertPresence(extra = {}){
    const refDoc = doc(db, "profiles", user.uid);
    const payload = { uid:user.uid, email:user.email, lastSeenAtMs: Date.now(), ...extra };
    await setDoc(refDoc, payload, { merge:true });
  }

  function displayName(){
    const n = (profile?.name || "").trim();
    if (n) return n;
    return (user?.email || "").split("@")[0] || "Employee";
  }

  function isBanned(){ return !!profile?.banned; }

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
    if($("boardPill")) $("boardPill").textContent = def.name;
    if($("feedTitle")) $("feedTitle").textContent = def.key === "ALL" ? "Marketplace" : def.name;

    [...($("boards")?.querySelectorAll(".boardBtn") || [])].forEach(btn=>{
      btn.classList.toggle("active", btn.dataset.key === key);
    });

    render();
  }

  function renderBoards(){
    const wrap = $("boards");
    if(!wrap) return;
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
    const q = ($("q")?.value || "").trim().toLowerCase();
    const st = $("st")?.value;
    const sort = $("sort")?.value;

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
    if (!cards || !empty) return;

    const filtered = applyFilters(listings);

    if($("countLine")) $("countLine").textContent = `${filtered.length} shown • ${listings.length} total`;
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
        </div>
      `;

      cards.appendChild(el);
    }
  }

  async function openThread(id){
    const item = listings.find(x => x.id === id);
    if (!item) return;

    openThreadId = id;
    if($("threadTitle")) $("threadTitle").textContent = item.title || "Thread";
    if($("threadMeta")) $("threadMeta").textContent = `${catLabel(item.category)} • Posted by ${item.displayName || item.userEmail || "—"} • ${prettyTime(item.createdAt)}`;
    if($("threadBody")) $("threadBody").innerHTML = `
      <div style="display:grid;gap:10px">
        ${item.photo ? `<img src="${item.photo}" style="width:100%;max-height:360px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,.10)">` : ""}
        <div>${esc(item.desc || "")}</div>
        <div class="meta">${item.location ? `Location: ${esc(item.location)} • ` : ""}${item.contact ? `Contact: ${esc(item.contact)}` : ""}</div>
      </div>
    `;

    renderReplies(item.replies || []);
    if($("replyText")) $("replyText").value = "";
    show("threadOverlay");
  }

  function renderReplies(replies){
    const wrap = $("threadReplies");
    if(!wrap) return;
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
          <div class="replyTime">${esc(prettyTime(r.createdAt ?? r.createdAtMs))}</div>
        </div>
        <div class="replyText">${esc(r.text || "")}</div>
      `;
      wrap.appendChild(div);
    }
  }

  async function uploadImageToStorage(file){
    const path = `listingPhotos/${user.uid}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  }

  async function createPost(){
    const title = $("fTitle")?.value.trim();
    if (!title) return alert("Enter a title.");

    const priceRaw = $("fPrice")?.value.trim();
    let price = "";
    if (priceRaw !== ""){
      const n = Number(priceRaw);
      if (!Number.isFinite(n) || n < 0) return alert("Price must be 0 or more.");
      price = n;
    }

    let photoUrl = "";
    const file = $("fPhoto")?.files?.[0];
    if (file){
      if (!file.type.startsWith("image/")) return alert("Select an image file.");
      photoUrl = await uploadImageToStorage(file);
    }

    await addDoc(collection(db, "listings"), {
      uid: user.uid,
      userEmail: user.email,
      displayName: displayName(),
      category: $("fBoard").value,
      status: $("fStatus").value,
      title,
      price,
      location: $("fLocation").value.trim(),
      desc: $("fDesc").value.trim(),
      contact: $("fContact").value.trim(),
      photo: photoUrl,
      replies: [],
      createdAtMs: Date.now(),
    });

    if($("fTitle")) $("fTitle").value = "";
    if($("fPrice")) $("fPrice").value = "";
    if($("fLocation")) $("fLocation").value = "";
    if($("fDesc")) $("fDesc").value = "";
    if($("fContact")) $("fContact").value = "";
    if($("fPhoto")) $("fPhoto").value = "";
    if($("fStatus")) $("fStatus").value = "ACTIVE";
    if($("fBoard")) $("fBoard").value = "FREE";

    hide("postOverlay");
  }

  async function sendReply(){
    if (!openThreadId) return;
    const txt = $("replyText")?.value.trim();
    if (!txt) return;

    const refDoc = doc(db, "listings", openThreadId);
    const snap = await getDoc(refDoc);
    if (!snap.exists()) return alert("Post not found.");

    const data = snap.data();
    const replies = Array.isArray(data.replies) ? data.replies.slice() : [];
    replies.push({
      userEmail: user.email,
      displayName: displayName(),
      text: txt,
      createdAtMs: Date.now()
    });

    try{
      await updateDoc(refDoc, { replies });
      if($("replyText")) $("replyText").value = "";
    }catch(e){
      console.error(e);
      alert("Reply failed to post. Ask Michael to check Firestore rules or internet.");
    }
  }

  $("btnLogin")?.addEventListener("click", async ()=>{
    const email = $("loginEmail")?.value.trim();
    const pass = $("loginPassword")?.value.trim();
    if (!email || !pass) return alert("Enter email and password.");
    if (!isAllowedEmail(email)) return alert("Use your @regallakeland.com email.");
    try{
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      if (!cred.user.emailVerified){
        if($("verifyNote")) $("verifyNote").style.display = "block";
        if($("btnResendVerify")) $("btnResendVerify").style.display = "inline-flex";
        alert("Please verify your email before using the marketplace. Check your inbox.");
        await signOut(auth);
        return;
      }
    }catch(e){
      console.error(e);
      alert(e?.code ? `${e.code} — ${e.message}` : "Login failed. Check email/password.");
    }
  });

  $("btnSignup")?.addEventListener("click", async ()=>{
    const email = $("signupEmail").value.trim();
    const p1 = $("signupPassword").value.trim();
    const p2 = $("signupPassword2").value.trim();
    const msg = $("signupMsg");
    if(!msg) return;
    msg.style.display = "none";
    msg.textContent = "";
    if (!email || !p1 || !p2) return alert("Fill out email and both password boxes.");
    if (!isAllowedEmail(email)) return alert("Use your @regallakeland.com email.");
    if (p1.length < 8) return alert("Password must be at least 8 characters.");
    if (p1 !== p2) return alert("Passwords do not match.");
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, p1);
      await sendEmailVerification(cred.user);
      msg.style.display = "block";
      msg.textContent = "Account created! Verification email sent. Verify your email, then return to Login.";
      alert("Account created. Check your email to verify before logging in.");
      await signOut(auth);
      showPane("login");
      if($("loginEmail")) $("loginEmail").value = email;
      if($("loginPassword")) $("loginPassword").value = "";
      if($("verifyNote")) $("verifyNote").style.display = "block";
      if($("btnResendVerify")) $("btnResendVerify").style.display = "inline-flex";
    }catch(e){
      console.error(e);
      alert(e?.message || "Signup failed.");
    }
  });

  $("btnLogout")?.addEventListener("click", async ()=>{
    await signOut(auth);
    location.reload();
  });

  $("btnNew")?.addEventListener("click", ()=> show("postOverlay"));
  $("btnSavePost")?.addEventListener("click", ()=> createPost());
  $("btnSendReply")?.addEventListener("click", ()=> sendReply());
          
  function showNameOverlay(){
    if($("displayNameInput")) $("displayNameInput").value = profile?.name || "";
    show("nameOverlay");
    $("displayNameInput")?.focus();
  }
  function hideNameOverlay(){ hide("nameOverlay"); }

  $("btnSaveName")?.addEventListener("click", async ()=>{
    const name = ($("displayNameInput")?.value || "").trim();
    if (!name) return alert("Please enter your first and last name.");
    await upsertPresence({ name });
    await loadProfile();
    hideNameOverlay();
    if($("pillUser")) $("pillUser").textContent = `Signed in: ${displayName()}`;
    render();
  });



  $("btnResendVerify")?.addEventListener("click", async ()=>{
    try{
      const currentUser = auth.currentUser;
      if (currentUser){
        await sendEmailVerification(currentUser);
        alert("Verification email resent. Check your inbox and spam folder.");
      } else {
        alert("Sign in again or create the account again to trigger a new verification email.");
      }
    }catch(e){
      console.error(e);
      alert(e?.message || "Could not resend verification email.");
    }
  });

  $("q")?.addEventListener("input", render);
  $("st")?.addEventListener("change", render);
  $("sort")?.addEventListener("change", render);

  onAuthStateChanged(auth, async (currentUser)=>{
    user = currentUser || null;

    if (!user){
      profile = null;
      if ($("pillUser")) $("pillUser").textContent = "Signed out";
      stopListingsListener();
      show("loginOverlay");
      hide("nameOverlay");
      return;
    }

    if (!user.emailVerified){
      if($("verifyNote")) $("verifyNote").style.display = "block";
      if($("btnResendVerify")) $("btnResendVerify").style.display = "inline-flex";
      alert("Please verify your email before using the marketplace. Check your inbox.");
      await signOut(auth);
      return;
    }

    hide("loginOverlay");
    await upsertPresence();
    await loadProfile();
    if ($("pillUser")) $("pillUser").textContent = `Signed in: ${displayName()}`;
    startListingsListener();

    if (!profile?.name){
      showNameOverlay();
    } else {
      hideNameOverlay();
    }
  });

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
  });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMarketplace, { once: true });
} else {
  initMarketplace();
}
}
