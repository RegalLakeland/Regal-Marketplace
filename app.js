import { firebaseConfig, ADMIN_EMAILS, DEFAULT_TABS, PROFANITY_WORDS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const byId = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let currentMode = "classic";
let forumView = { type: "boards", sectionId: null, threadId: null };
let currentPosts = [];
let composeImages = [];
let editingId = null;
let replyTargetId = null;
let postsUnsub = null;
let tabsUnsub = null;
let currentTabs = [...DEFAULT_TABS];

function slugify(text){
  return String(text || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function groupTabs(tabs){
  const groups = {};
  for (const tab of tabs) {
    const group = tab.group || "Marketplace";
    if (!groups[group]) groups[group] = [];
    groups[group].push(tab);
  }
  return Object.entries(groups).map(([title, sections]) => ({ title, sections }));
}
function getSectionById(id){ return currentTabs.find(s => s.id === id); }
function validWorkEmail(email){ return String(email || "").toLowerCase().endsWith("@regallakeland.com"); }
function initials(name){ return String(name || "?").split(" ").filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join(""); }
function formatDate(v){
  if(!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function showNotice(id, msg){ const el = byId(id); el.textContent = msg; el.hidden = false; }
function hideNotice(id){ const el = byId(id); el.hidden = true; el.textContent = ""; }
function isAdmin(){ return !!currentUser && ADMIN_EMAILS.includes(currentUser.email.toLowerCase()); }
function containsProfanity(text){
  const lower = String(text || "").toLowerCase();
  return PROFANITY_WORDS.some(w => lower.includes(w));
}
function bindSlideshow(){
  const slides = [...document.querySelectorAll(".bg-slide")];
  let i = 0;
  setInterval(() => {
    slides[i].classList.remove("active");
    i = (i + 1) % slides.length;
    slides[i].classList.add("active");
  }, 4200);
}
bindSlideshow();

async function ensureTabsDoc(){
  const refTabs = doc(db, "settings", "tabs");
  const snap = await getDoc(refTabs);
  if (!snap.exists()) {
    await setDoc(refTabs, {
      tabs: DEFAULT_TABS,
      updatedAt: serverTimestamp()
    });
  }
}
function syncAuthUI(){
  const loggedIn = !!currentUser && !!currentProfile;
  byId("authGate").hidden = loggedIn;
  byId("shell").hidden = !loggedIn;
  byId("adminLink").hidden = !isAdmin();
  if(loggedIn){
    byId("userChip").textContent = `${currentProfile.displayName} • ${currentUser.email}`;
  }
}
function switchAuthTab(mode){
  byId("loginPane").hidden = mode !== "login";
  byId("signupPane").hidden = mode !== "signup";
  byId("loginTab").classList.toggle("active", mode === "login");
  byId("signupTab").classList.toggle("active", mode === "signup");
  hideNotice("authMsg");
}
async function ensureProfile(uid){
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
async function signup(){
  try{
    hideNotice("authMsg");
    const displayName = byId("signupName").value.trim();
    const email = byId("signupEmail").value.trim().toLowerCase();
    const p1 = byId("signupPassword").value.trim();
    const p2 = byId("signupPassword2").value.trim();
    if(!displayName) throw new Error("Enter a display name.");
    if(!validWorkEmail(email)) throw new Error("Only @regallakeland.com emails are allowed.");
    if(p1.length < 8) throw new Error("Password must be at least 8 characters.");
    if(p1 !== p2) throw new Error("Passwords do not match.");
    const q = query(collection(db, "profiles"), where("displayNameLower", "==", displayName.toLowerCase()));
    const matches = await getDocs(q);
    if(!matches.empty) throw new Error("That display name is already taken.");
    const cred = await createUserWithEmailAndPassword(auth, email, p1);
    await setDoc(doc(db, "profiles", cred.user.uid), {
      uid: cred.user.uid,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      email,
      role: ADMIN_EMAILS.includes(email) ? "admin" : "user",
      banned: false,
      createdAt: serverTimestamp()
    });
    await sendEmailVerification(cred.user);
    await signOut(auth);
    showNotice("authMsg", "Account created. Verify your email, then log in.");
    switchAuthTab("login");
    byId("loginEmail").value = email;
  }catch(err){
    showNotice("authMsg", err.message || "Signup failed.");
  }
}
async function login(){
  try{
    hideNotice("authMsg");
    const email = byId("loginEmail").value.trim().toLowerCase();
    const password = byId("loginPassword").value.trim();
    if(!validWorkEmail(email)) throw new Error("Only @regallakeland.com emails are allowed.");
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    showNotice("authMsg", err.message || "Login failed.");
  }
}
async function forgotPassword(){
  try{
    hideNotice("authMsg");
    const email = byId("loginEmail").value.trim().toLowerCase();
    if(!validWorkEmail(email)) throw new Error("Enter a valid work email.");
    await sendPasswordResetEmail(auth, email);
    showNotice("authMsg", "Password reset email sent.");
  }catch(err){
    showNotice("authMsg", err.message || "Password reset failed.");
  }
}
async function logout(){ await signOut(auth); }

function resetComposer(){
  editingId = null;
  composeImages = [];
  byId("composeHeading").textContent = "Create Post";
  byId("savePostBtn").textContent = "Publish";
  byId("composeTitle").value = "";
  byId("composeBody").value = "";
  byId("composePrice").value = "";
  byId("composeLocation").value = "Lakeland";
  byId("composeContact").value = "";
  byId("composeStatus").value = "active";
  byId("composeImages").value = "";
  byId("composePreview").innerHTML = "";
  hideNotice("composeMsg");
}
function populateSections(selected = ""){
  byId("composeSection").innerHTML = currentTabs.map(s => `<option value="${s.id}" ${selected===s.id?"selected":""}>${esc(s.name)}</option>`).join("");
}
function openComposer(postId = null){
  resetComposer();
  editingId = postId;
  if(postId){
    const post = getPostById(postId);
    if(!post) return;
    byId("composeHeading").textContent = "Edit Post";
    byId("savePostBtn").textContent = "Save Changes";
    populateSections(post.sectionId);
    byId("composeTitle").value = post.title || "";
    byId("composeBody").value = post.body || "";
    byId("composePrice").value = post.price === "FREE" ? "" : (post.price || "");
    byId("composeLocation").value = post.location || "";
    byId("composeContact").value = post.contact || "";
    byId("composeStatus").value = post.status || "active";
    composeImages = Array.isArray(post.imageUrls) ? [...post.imageUrls] : [];
    byId("composePreview").innerHTML = composeImages.map(src => `<img src="${src}" alt="">`).join("");
  } else {
    populateSections();
  }
  byId("composeModal").hidden = false;
}
function closeComposer(){ byId("composeModal").hidden = true; }

function getPostsBySection(sectionId){
  return currentPosts.filter(p => p.sectionId === sectionId).sort((a,b) => getLastActivity(b) - getLastActivity(a));
}
function getLastReply(post){ return post.replies?.length ? post.replies[post.replies.length - 1] : null; }
function getLastActivity(post){
  const reply = getLastReply(post);
  const value = reply?.createdAt || post.createdAt;
  return value?.toDate ? value.toDate() : new Date(value || 0);
}
function getPostById(id){ return currentPosts.find(p => p.id === id); }

function renderClassic(){
  const appRoot = byId("appRoot");
  const posts = [...currentPosts].sort((a,b) => getLastActivity(b) - getLastActivity(a));
  appRoot.innerHTML = `
    <div class="header-row">
      <div><h2>Classic View</h2><div class="sub">OfferUp-style browsing with image-first cards</div></div>
    </div>
    <div class="classic-grid">
      ${posts.map(post => {
        const canEdit = currentUser && post.ownerUid === currentUser.uid;
        return `
          <div class="grid-card">
            <div class="grid-media">
              ${post.imageUrls?.length ? `<img src="${post.imageUrls[0]}" alt="">` : ``}
              <div class="badge ${post.status==="sold"?"sold":""}">${esc(post.status === "sold" ? "Sold" : "Active")}</div>
            </div>
            <div class="grid-body">
              <div class="grid-title">${esc(post.title)}</div>
              <div class="price-pill">${esc(post.price || "FREE")}</div>
              <div class="meta">${esc(getSectionById(post.sectionId)?.name || post.sectionId || "")} • ${esc(post.location || "Lakeland")} • ${esc(post.authorName || "")}</div>
              <div class="body-text">${esc(post.body || "").slice(0, 160)}${(post.body || "").length > 160 ? "..." : ""}</div>
              <div class="actions">
                <button class="btn open-post" data-id="${post.id}" type="button">Open</button>
                ${canEdit ? `<button class="btn edit-post" data-id="${post.id}" type="button">Edit</button><button class="btn sold-post" data-id="${post.id}" type="button">${post.status==="sold"?"Mark Active":"Mark Sold"}</button>` : ""}
                ${isAdmin() ? `<button class="btn danger admin-del" data-id="${post.id}" type="button">Delete</button>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
  appRoot.querySelectorAll(".open-post").forEach(btn => btn.addEventListener("click", () => {
    forumView = { type: "thread", sectionId: getPostById(btn.dataset.id)?.sectionId || null, threadId: btn.dataset.id };
    currentMode = "forum";
    updateModeButtons();
    render();
  }));
  appRoot.querySelectorAll(".edit-post").forEach(btn => btn.addEventListener("click", () => openComposer(btn.dataset.id)));
  appRoot.querySelectorAll(".sold-post").forEach(btn => btn.addEventListener("click", () => toggleSold(btn.dataset.id)));
  appRoot.querySelectorAll(".admin-del").forEach(btn => btn.addEventListener("click", () => deletePost(btn.dataset.id)));
}

function boardRowHtml(section){
  const posts = getPostsBySection(section.id);
  const last = posts[0];
  const lastReply = last ? getLastReply(last) : null;
  return `
    <div class="board-row" data-section="${section.id}">
      <div class="board-main">
        <div class="avatar">💬</div>
        <div>
          <div class="title">${esc(section.name)}</div>
          <div class="desc">${esc(section.desc)}</div>
        </div>
      </div>
      <div class="stat">${posts.length}<span>threads</span></div>
      <div class="last">
        ${last?.imageUrls?.length ? `<div class="thumb"><img src="${last.imageUrls[0]}" alt=""></div>` : `<div class="mini">${last ? initials(lastReply ? lastReply.author : last.authorName) : "—"}</div>`}
        <div>
          <div style="font-size:16px;font-weight:800">${last ? esc(last.title) : "No threads yet"}</div>
          <div class="desc">${last ? `${esc(lastReply ? lastReply.author : last.authorName)}, ${formatDate(getLastActivity(last))}` : "Start the first thread"}</div>
        </div>
      </div>
    </div>
  `;
}
function renderBoards(){
  const appRoot = byId("appRoot");
  const groups = groupTabs(currentTabs);
  appRoot.innerHTML = groups.map(group => `
    <div class="section-group-title">${esc(group.title)}</div>
    <div class="board-table">${group.sections.map(boardRowHtml).join("")}</div>
  `).join("");
  appRoot.querySelectorAll("[data-section]").forEach(row => row.addEventListener("click", () => {
    forumView = { type: "section", sectionId: row.dataset.section, threadId: null };
    render();
  }));
}
function topicRowHtml(post){
  const lastReply = getLastReply(post);
  return `
    <div class="topic-row" data-thread="${post.id}">
      <div class="topic-main">
        ${post.imageUrls?.length ? `<div class="thumb"><img src="${post.imageUrls[0]}" alt=""></div>` : `<div class="avatar">💬</div>`}
        <div>
          <div class="title">${esc(post.title)}</div>
          <div class="desc">${esc(post.authorName)}, ${formatDate(post.createdAt)} • ${esc(post.price || "FREE")}</div>
        </div>
      </div>
      <div class="stat">${(post.replies || []).length}<span>replies</span></div>
      <div class="stat">${post.views || 0}<span>views</span></div>
      <div class="last">
        <div class="mini">${initials(lastReply ? lastReply.author : post.authorName)}</div>
        <div>
          <div style="font-size:16px;font-weight:800">${esc(lastReply ? lastReply.author : post.authorName)}</div>
          <div class="desc">${formatDate(getLastActivity(post))}</div>
        </div>
      </div>
    </div>
  `;
}
function bindTopicRows(sectionId){
  document.querySelectorAll("[data-thread]").forEach(row => row.addEventListener("click", () => {
    forumView = { type: "thread", sectionId, threadId: row.dataset.thread };
    render();
  }));
}
function renderSection(sectionId){
  const section = getSectionById(sectionId);
  const posts = getPostsBySection(sectionId);
  const appRoot = byId("appRoot");
  appRoot.innerHTML = `
    <div class="breadcrumbs"><a href="#" id="crumbBoards">Boards</a> / ${esc(section?.name || sectionId)}</div>
    <div class="header-row">
      <div><h2>${esc(section?.name || sectionId)}</h2><div class="sub">${esc(section?.desc || "")}</div></div>
      <input id="sectionSearch" class="search" placeholder="Search this section...">
    </div>
    <div id="topicTable" class="topic-table">${posts.length ? posts.map(topicRowHtml).join("") : `<div class="empty">No threads in this section yet.</div>`}</div>
  `;
  byId("crumbBoards").addEventListener("click", (e) => {
    e.preventDefault();
    forumView = { type: "boards", sectionId: null, threadId: null };
    render();
  });
  bindTopicRows(sectionId);
  byId("sectionSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = posts.filter(p => (`${p.title} ${p.body} ${p.authorName} ${p.contact}`).toLowerCase().includes(q));
    byId("topicTable").innerHTML = filtered.length ? filtered.map(topicRowHtml).join("") : `<div class="empty">No matching threads found.</div>`;
    bindTopicRows(sectionId);
  });
}
async function renderThread(postId){
  const post = getPostById(postId);
  if(!post) return;
  const section = getSectionById(post.sectionId);
  const replyHtml = (post.replies || []).length ? post.replies.map(r => `
    <div class="reply-card">
      <div class="reply-top"><div class="reply-author">${esc(r.author)}</div><div class="reply-date">${formatDate(r.createdAt)}</div></div>
      <div style="margin-top:10px;line-height:1.55">${esc(r.body)}</div>
    </div>
  `).join("") : `<div class="empty">No replies yet. Be the first to respond.</div>`;
  const canEdit = currentUser && post.ownerUid === currentUser.uid;
  const gallery = post.imageUrls?.length ? `<div class="gallery">${post.imageUrls.map(url => `<img src="${url}" alt="">`).join("")}</div>` : "";
  const appRoot = byId("appRoot");
  appRoot.innerHTML = `
    <div class="breadcrumbs"><a href="#" id="crumbBoards">Boards</a> / <a href="#" id="crumbSection">${esc(section?.name || post.sectionId)}</a> / ${esc(post.title)}</div>
    <div class="thread-card">
      <div class="thread-top">
        <div>
          <div class="thread-title">${esc(post.title)}</div>
          <div class="meta-line">Started by ${esc(post.authorName)} • ${formatDate(post.createdAt)}</div>
        </div>
        <div class="price-pill">${esc(post.price || "FREE")} • ${esc(post.status === "sold" ? "Sold" : "Active")}</div>
      </div>
      <div class="body-text" style="font-size:15px">${esc(post.body || "")}</div>
      ${gallery}
      <div class="info-grid">
        <div class="info"><div class="info-label">Location</div><div class="info-value">${esc(post.location || "Not listed")}</div></div>
        <div class="info"><div class="info-label">Contact</div><div class="info-value">${esc(post.contact || "Not listed")}</div></div>
        <div class="info"><div class="info-label">Views / Replies</div><div class="info-value">${post.views || 0} views • ${(post.replies || []).length} replies</div></div>
      </div>
      <div class="actions">
        <button id="replyBtn" class="btn primary" type="button">Reply</button>
        ${canEdit ? `<button id="editBtn" class="btn" type="button">Edit</button><button id="soldBtn" class="btn" type="button">${post.status==="sold"?"Mark Active":"Mark Sold"}</button>` : ""}
        ${isAdmin() ? `<button id="deleteBtn" class="btn danger" type="button">Delete</button>` : ""}
        <button id="backBtn" class="btn" type="button">Back to ${esc(section?.name || post.sectionId)}</button>
      </div>
    </div>
    <div class="replies-wrap"><div class="reply-title">Replies</div>${replyHtml}</div>
  `;
  byId("crumbBoards").addEventListener("click", (e) => {
    e.preventDefault();
    forumView = { type: "boards", sectionId: null, threadId: null };
    render();
  });
  byId("crumbSection").addEventListener("click", (e) => {
    e.preventDefault();
    forumView = { type: "section", sectionId: post.sectionId, threadId: null };
    render();
  });
  byId("backBtn").addEventListener("click", () => {
    forumView = { type: "section", sectionId: post.sectionId, threadId: null };
    render();
  });
  byId("replyBtn").addEventListener("click", () => {
    replyTargetId = post.id;
    byId("replyModal").hidden = false;
  });
  if(canEdit){
    byId("editBtn").addEventListener("click", () => openComposer(post.id));
    byId("soldBtn").addEventListener("click", () => toggleSold(post.id));
  }
  if(isAdmin()){
    byId("deleteBtn").addEventListener("click", () => deletePost(post.id));
  }
  if(currentUser && post.ownerUid !== currentUser.uid){
    await updateDoc(doc(db, "posts", post.id), { views: (post.views || 0) + 1 });
  }
}
function updateModeButtons(){
  byId("classicBtn").classList.toggle("active", currentMode === "classic");
  byId("forumBtn").classList.toggle("active", currentMode === "forum");
}
function render(){
  updateModeButtons();
  if(currentMode === "classic"){ renderClassic(); }
  else if(forumView.type === "boards"){ renderBoards(); }
  else if(forumView.type === "section"){ renderSection(forumView.sectionId); }
  else { renderThread(forumView.threadId); }
}
function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function uploadImages(postId, files){
  const urls = [];
  const limited = [...files].slice(0, 10);
  for(const file of limited){
    const storageRef = ref(storage, `posts/${postId}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    urls.push(await getDownloadURL(storageRef));
  }
  return urls;
}
async function handleComposeImages(files){
  const limited = [...files].slice(0, 10);
  const previews = await Promise.all(limited.map(fileToDataURL));
  const existingRemote = composeImages.filter(url => String(url).startsWith("http"));
  composeImages = [...existingRemote, ...previews];
  byId("composePreview").innerHTML = composeImages.map(src => `<img src="${src}" alt="">`).join("");
}
async function savePost(){
  try{
    hideNotice("composeMsg");
    const sectionId = byId("composeSection").value;
    const title = byId("composeTitle").value.trim();
    const body = byId("composeBody").value.trim();
    const rawPrice = byId("composePrice").value.trim();
    const price = rawPrice || "FREE";
    const location = byId("composeLocation").value.trim() || "Lakeland";
    const contact = byId("composeContact").value.trim();
    const status = byId("composeStatus").value;
    const files = byId("composeImages").files;
    if(!title || !body) throw new Error("Title and description are required.");

    if(editingId){
      const existing = getPostById(editingId);
      let imageUrls = existing.imageUrls || [];
      if(files.length){ imageUrls = await uploadImages(editingId, files); }
      await updateDoc(doc(db, "posts", editingId), {
        sectionId, title, body, price, location, contact, status, imageUrls, updatedAt: serverTimestamp()
      });
    } else {
      const newRef = doc(collection(db, "posts"));
      const newId = newRef.id;
      let imageUrls = [];
      if(files.length){ imageUrls = await uploadImages(newId, files); }
      await setDoc(newRef, {
        ownerUid: currentUser.uid,
        ownerEmail: currentUser.email,
        authorName: currentProfile.displayName,
        sectionId, title, body, price, location, contact, status,
        imageUrls, replies: [], views: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }

    if(containsProfanity(`${title} ${body} ${contact}`)){
      await addDoc(collection(db, "moderationAlerts"), {
        type: "profanity",
        postTitle: title,
        byEmail: currentUser.email,
        createdAt: serverTimestamp(),
        message: "Profanity flagged for admin review."
      });
    }
    closeComposer();
  }catch(err){
    showNotice("composeMsg", err.message || "Save failed.");
  }
}
async function saveReply(){
  try{
    const body = byId("replyBody").value.trim();
    if(!body || !replyTargetId) return;
    const post = getPostById(replyTargetId);
    const replies = [...(post.replies || []), {
      author: currentProfile.displayName,
      body,
      createdAt: new Date().toISOString()
    }];
    await updateDoc(doc(db, "posts", replyTargetId), { replies });
    byId("replyBody").value = "";
    byId("replyModal").hidden = true;
  }catch(err){
    console.error(err);
  }
}
async function toggleSold(postId){
  const post = getPostById(postId);
  if(!post) return;
  await updateDoc(doc(db, "posts", postId), { status: post.status === "sold" ? "active" : "sold" });
}
async function deletePost(postId){
  if(!isAdmin()) return;
  if(!confirm("Delete this post?")) return;
  await deleteDoc(doc(db, "posts", postId));
}
function subscribePosts(){
  if(postsUnsub) postsUnsub();
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  postsUnsub = onSnapshot(q, (snap) => {
    currentPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
}
function subscribeTabs(){
  if(tabsUnsub) tabsUnsub();
  const refTabs = doc(db, "settings", "tabs");
  tabsUnsub = onSnapshot(refTabs, async (snap) => {
    if (!snap.exists()) {
      await ensureTabsDoc();
      return;
    }
    currentTabs = (snap.data().tabs || DEFAULT_TABS).filter(t => t && t.id && t.name);
    render();
  });
}

byId("loginTab").onclick = () => switchAuthTab("login");
byId("signupTab").onclick = () => switchAuthTab("signup");
byId("loginBtn").onclick = login;
byId("signupBtn").onclick = signup;
byId("forgotBtn").onclick = forgotPassword;
byId("logoutBtn").onclick = logout;
byId("boardsBtn").onclick = () => { currentMode = "forum"; forumView = { type: "boards", sectionId: null, threadId: null }; render(); };
byId("classicBtn").onclick = () => { currentMode = "classic"; render(); };
byId("forumBtn").onclick = () => { currentMode = "forum"; render(); };
byId("newBtn").onclick = () => openComposer();
byId("closeComposeBtn").onclick = closeComposer;
byId("savePostBtn").onclick = savePost;
byId("composeImages").addEventListener("change", (e) => handleComposeImages(e.target.files));
byId("closeReplyBtn").onclick = () => { byId("replyModal").hidden = true; };
byId("saveReplyBtn").onclick = saveReply;

onAuthStateChanged(auth, async (user) => {
  if(!user){
    currentUser = null;
    currentProfile = null;
    syncAuthUI();
    return;
  }
  currentUser = user;
  currentProfile = await ensureProfile(user.uid);

  if(!currentProfile){
    const fallbackName = (user.email || "Employee").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    await setDoc(doc(db, "profiles", user.uid), {
      uid: user.uid,
      displayName: fallbackName,
      displayNameLower: fallbackName.toLowerCase(),
      email: user.email,
      role: ADMIN_EMAILS.includes((user.email || "").toLowerCase()) ? "admin" : "user",
      banned: false,
      createdAt: serverTimestamp()
    }, { merge: true });
    currentProfile = await ensureProfile(user.uid);
  }

  if(currentProfile.banned){
    showNotice("authMsg", "This account has been banned.");
    await signOut(auth);
    return;
  }

  await ensureTabsDoc();
  syncAuthUI();
  subscribeTabs();
  subscribePosts();
});
