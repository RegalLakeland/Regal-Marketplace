const WORK_DOMAIN = "@regallakeland.com";
const ADMIN_SET = new Set(ADMIN_EMAILS.map(x => x.toLowerCase()));
const BOARDS = [
  { key:"ALL", name:"All", desc:"Everything in one place" },
  { key:"FREE", name:"Free Items", desc:"Giveaways • curb alerts" },
  { key:"BUYSELL", name:"Buy / Sell", desc:"Items for sale" },
  { key:"GARAGE", name:"Garage Sales", desc:"Yard sales • moving sales" },
  { key:"EVENTS", name:"Events", desc:"BBQ • meetups • birthdays" },
  { key:"WORK", name:"Work News", desc:"Updates • announcements" },
  { key:"SERVICES", name:"Services", desc:"Side work • help needed" }
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const phoneLike = /^[+]?[-(). 0-9]{7,}$/;

let me = null;
let listings = [];
let activeBoard = "ALL";
let editingId = null;
let openThreadId = null;
let unsubListings = null;
let unsubThread = null;

function setMsg(id, text="", kind=""){
  const el = $(id);
  if(!text){ el.hidden = true; el.textContent = ""; el.className = "msg"; return; }
  el.hidden = false;
  el.textContent = text;
  el.className = "msg " + kind;
}
function show(id){ $(id).hidden = false; }
function hide(id){ $(id).hidden = true; }
function prettyTime(ms){ return ms ? new Date(ms).toLocaleString() : "—"; }
function isAdmin(){ return !!me && ADMIN_SET.has(String(me.email || "").toLowerCase()); }
function displayName(){ return me?.name || (me?.email || "").split("@")[0] || "Employee"; }
function validWorkEmail(email){ return String(email || "").toLowerCase().endsWith(WORK_DOMAIN); }

function getStorageRef(path){
  try {
    return firebase.app().storage("gs://regal-lakeland-marketplace.appspot.com").ref(path);
  } catch (e) {
    return storage.ref(path);
  }
}

function priceText(item){
  const n = Number(item.price || 0);
  return (item.board === "FREE" || n <= 0.01) ? "FREE" : "$" + n.toFixed(n % 1 === 0 ? 0 : 2);
}
function boardCounts(){
  const counts = { ALL:0, FREE:0, BUYSELL:0, GARAGE:0, EVENTS:0, WORK:0, SERVICES:0 };
  listings.forEach(item => {
    counts.ALL += 1;
    if(counts[item.board] !== undefined) counts[item.board] += 1;
  });
  return counts;
}
function togglePrice(){
  $("priceWrap").style.display = $("postBoard").value === "FREE" ? "none" : "flex";
  if($("postBoard").value === "FREE") $("postPrice").value = "";
}
function syncUI(){
  $("userPill").textContent = me ? `${displayName()}${isAdmin() ? " • Admin" : ""}` : "Not signed in";
  $("btnNewPost").hidden = !me;
  $("btnLogout").hidden = !me;
  $("adminLink").hidden = !(me && isAdmin());
  if(me) hide("authOverlay"); else show("authOverlay");
}
function resetPostForm(){
  editingId = null;
  $("postModalTitle").textContent = "Create Post";
  $("btnSavePost").textContent = "Save Post";
  $("postBoard").value = "FREE";
  $("postStatus").value = "ACTIVE";
  $("postTitle").value = "";
  $("postPrice").value = "";
  $("postLocation").value = "";
  $("postDesc").value = "";
  $("postContact").value = "";
  $("postPhotos").value = "";
  togglePrice();
  setMsg("postMsg");
}
function fillPostForm(item){
  editingId = item.id;
  $("postModalTitle").textContent = "Edit Post";
  $("btnSavePost").textContent = "Update Post";
  $("postBoard").value = item.board || "FREE";
  $("postStatus").value = item.status || "ACTIVE";
  $("postTitle").value = item.title || "";
  $("postPrice").value = item.board === "FREE" ? "" : (item.price ?? "");
  $("postLocation").value = item.location || "";
  $("postDesc").value = item.desc || "";
  $("postContact").value = item.contact || "";
  $("postPhotos").value = "";
  togglePrice();
  setMsg("postMsg");
  show("postModal");
}
async function uploadPhotos(postId, files){
  if(files.length > 10) throw new Error("Maximum 10 images per post.");
  const urls = [];
  for(const file of files){
    const ref = getStorageRef(`posts/${postId}/${Date.now()}_${file.name}`);
    const snap = await ref.put(file);
    const url = await snap.ref.getDownloadURL();
    urls.push(url);
  }
  return urls;
}
function renderBoards(){
  const counts = boardCounts();
  const wrap = $("boardList");
  wrap.innerHTML = "";
  BOARDS.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "board" + (activeBoard === b.key ? " active" : "");
    btn.type = "button";
    btn.innerHTML = `<div><div class="board-name">${esc(b.name)}</div><div class="board-desc">${esc(b.desc)}</div></div><div class="board-count">${counts[b.key] || 0}</div>`;
    btn.onclick = () => {
      activeBoard = b.key;
      $("sectionTitle").textContent = b.key === "ALL" ? "Marketplace" : b.name;
      renderBoards();
      renderListings();
    };
    wrap.appendChild(btn);
  });
}
function filteredListings(){
  let arr = listings.slice();
  const q = $("searchBox").value.trim().toLowerCase();
  const st = $("statusFilter").value;
  const sort = $("sortFilter").value;

  if(activeBoard !== "ALL") arr = arr.filter(x => x.board === activeBoard);
  if(st === "ACTIVE") arr = arr.filter(x => x.status !== "SOLD");
  if(st === "SOLD") arr = arr.filter(x => x.status === "SOLD");
  if(q) arr = arr.filter(x => `${x.title} ${x.desc} ${x.location} ${x.contact} ${x.displayName}`.toLowerCase().includes(q));

  if(sort === "PINNED_NEW") arr.sort((a,b) => (Number(b.pinned || 0) - Number(a.pinned || 0)) || ((b.createdAtMs || 0) - (a.createdAtMs || 0)));
  if(sort === "NEW") arr.sort((a,b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  if(sort === "OLD") arr.sort((a,b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  if(sort === "PRICE_ASC") arr.sort((a,b) => Number(a.price || 0) - Number(b.price || 0));
  if(sort === "PRICE_DESC") arr.sort((a,b) => Number(b.price || 0) - Number(a.price || 0));

  return arr;
}
function renderListings(){
  const arr = filteredListings();
  $("counts").textContent = `${arr.length} shown • ${listings.length} total`;
  $("emptyState").hidden = arr.length !== 0;
  const grid = $("grid");
  grid.innerHTML = "";

  arr.forEach(item => {
    const mine = me && item.uid === me.uid;
    const photos = Array.isArray(item.photoURLs) ? item.photoURLs : [];
    const thumb = photos[0] || "";
    const sold = item.status === "SOLD";
    const card = document.createElement("article");
    card.className = "listing";
    card.innerHTML = `
      <div class="thumb">
        ${thumb ? `<img src="${thumb}" alt="">` : `<div style="padding:14px;color:#9ca3af;font-size:12px;font-weight:800">No photo</div>`}
        <div class="badge ${sold ? "sold" : ((item.board === "FREE" || Number(item.price || 0) <= 0.01) ? "free" : "")}">${sold ? "SOLD" : ((item.board === "FREE" || Number(item.price || 0) <= 0.01) ? "FREE" : "AVAILABLE")}</div>
        ${item.pinned ? `<div class="badge pin">Pinned</div>` : ""}
        ${photos.length > 1 ? `<div class="photo-count">${photos.length} photos</div>` : ""}
      </div>
      <div class="card-body">
        <div class="card-row"><div class="card-title">${esc(item.title || "")}</div><div class="price-pill">${esc(priceText(item))}</div></div>
        <div class="subtle">${esc(item.board || "")}${item.location ? ` • ${esc(item.location)}` : ""}</div>
        <div class="card-desc">${esc(item.desc || "")}</div>
      </div>
      <div class="card-actions">
        <span class="pill">By: ${esc(item.displayName || item.userEmail || "")}</span>
        <button class="btn" data-act="open" data-id="${esc(item.id)}" type="button">Open</button>
        ${mine ? `<button class="btn" data-act="edit" data-id="${esc(item.id)}" type="button">Edit</button>` : ""}
        ${mine ? `<button class="btn danger" data-act="delete" data-id="${esc(item.id)}" type="button">Delete</button>` : ""}
        ${mine && item.board !== "FREE" && Number(item.price || 0) > 0.01 ? `<button class="btn" data-act="sold" data-id="${esc(item.id)}" type="button">${sold ? "Mark Active" : "Mark Sold"}</button>` : ""}
        ${isAdmin() ? `<button class="btn" data-act="pin" data-id="${esc(item.id)}" type="button">${item.pinned ? "Unpin" : "Pin"}</button>` : ""}
        ${isAdmin() ? `<button class="btn danger" data-act="admin-delete" data-id="${esc(item.id)}" type="button">Admin Delete</button>` : ""}
      </div>
    `;
    grid.appendChild(card);
  });
}
function subscribeListings(){
  if(unsubListings) unsubListings();
  unsubListings = db.collection("listings").orderBy("createdAtMs", "desc").onSnapshot(snapshot => {
    listings = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
    renderBoards();
    renderListings();
  }, err => {
    console.error(err);
    alert("Listings failed to load. Check Firestore rules and indexes.");
  });
}
function openThread(id){
  openThreadId = id;
  if(unsubThread) unsubThread();
  unsubThread = db.collection("listings").doc(id).onSnapshot(docSnap => {
    if(!docSnap.exists) return;
    const item = { id:docSnap.id, ...docSnap.data() };
    $("threadTitle").textContent = item.title || "Listing";
    $("threadMeta").textContent = `${item.board || ""} • Posted by ${item.displayName || item.userEmail || ""} • ${prettyTime(item.createdAtMs)}`;
    const photos = Array.isArray(item.photoURLs) ? item.photoURLs : [];
    $("threadGallery").innerHTML = photos.map(url => `<img src="${url}" alt="">`).join("");
    $("threadBody").innerHTML = `<div class="price-pill" style="display:inline-block;margin-bottom:10px">${esc(priceText(item))}</div><div>${esc(item.desc || "")}</div><div style="margin-top:10px" class="small-note">Contact: <strong>${esc(item.contact || "—")}</strong>${item.location ? ` • Location: <strong>${esc(item.location)}</strong>` : ""}</div>`;
    if(item.contact){
      $("contactBtn").hidden = false;
      $("contactBtn").href = phoneLike.test(item.contact) ? `tel:${item.contact.replace(/[^0-9+]/g, "")}` : `mailto:${item.contact}`;
    } else {
      $("contactBtn").hidden = true;
    }

    const wrap = $("replyList");
    wrap.innerHTML = "";
    const replies = item.replies || [];
    if(!replies.length){
      wrap.innerHTML = '<div class="small-note">No replies yet.</div>';
    } else {
      replies.forEach(r => {
        const div = document.createElement("div");
        div.className = "small-note";
        div.innerHTML = `<div><strong>${esc(r.by || "")}</strong> • ${esc(prettyTime(r.atMs))}</div><div style="margin-top:6px">${esc(r.text || "")}</div>`;
        wrap.appendChild(div);
      });
    }
  });
  $("replyText").value = "";
  setMsg("replyMsg");
  show("threadModal");
}

document.addEventListener("DOMContentLoaded", () => {
  $("tabLogin").onclick = () => {
    $("tabLogin").classList.add("active");
    $("tabSignup").classList.remove("active");
    $("loginPane").hidden = false;
    $("signupPane").hidden = true;
  };
  $("tabSignup").onclick = () => {
    $("tabSignup").classList.add("active");
    $("tabLogin").classList.remove("active");
    $("signupPane").hidden = false;
    $("loginPane").hidden = true;
  };

  $("btnLogin").onclick = async () => {
    try{
      setMsg("authMsg");
      const email = $("loginEmail").value.trim().toLowerCase();
      const password = $("loginPassword").value.trim();
      if(!validWorkEmail(email)) throw new Error("Use your @regallakeland.com email.");
      await auth.signInWithEmailAndPassword(email, password);
    }catch(e){
      setMsg("authMsg", e.message || "Login failed.", "error");
    }
  };

  $("btnSignup").onclick = async () => {
    try{
      setMsg("authMsg");
      const name = $("signupName").value.trim();
      const email = $("signupEmail").value.trim().toLowerCase();
      const p1 = $("signupPassword").value.trim();
      const p2 = $("signupPassword2").value.trim();
      if(!name) throw new Error("Enter display name.");
      if(!validWorkEmail(email)) throw new Error("Use your @regallakeland.com email.");
      if(p1.length < 8) throw new Error("Password must be at least 8 characters.");
      if(p1 !== p2) throw new Error("Passwords do not match.");
      if(!$("agreeRules").checked) throw new Error("You must agree to the rules.");

      const cred = await auth.createUserWithEmailAndPassword(email, p1);
      await db.collection("profiles").doc(cred.user.uid).set({
        uid: cred.user.uid,
        email,
        name,
        banned: false,
        createdAtMs: Date.now()
      }, { merge:true });
      await cred.user.sendEmailVerification();
      await auth.signOut();
      setMsg("authMsg", "Account created. Check your email and verify before logging in.", "ok");
      $("tabLogin").click();
      $("loginEmail").value = email;
    }catch(e){
      setMsg("authMsg", e.message || "Create account failed.", "error");
    }
  };

  $("btnForgot").onclick = async () => {
    try{
      const email = $("loginEmail").value.trim().toLowerCase();
      if(!validWorkEmail(email)) throw new Error("Enter your work email first.");
      await auth.sendPasswordResetEmail(email);
      setMsg("authMsg", "Password reset email sent.", "ok");
    }catch(e){
      setMsg("authMsg", e.message || "Reset failed.", "error");
    }
  };

  $("btnLogout").onclick = async () => {
    await auth.signOut();
  };

  $("btnNewPost").onclick = () => {
    resetPostForm();
    show("postModal");
  };
  $("btnClosePost").onclick = () => {
    hide("postModal");
    resetPostForm();
  };
  $("postBoard").onchange = togglePrice;

  $("btnSavePost").onclick = async () => {
    const saveBtn = $("btnSavePost");
    const originalLabel = editingId ? "Update Post" : "Save Post";
    try{
      setMsg("postMsg");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      if(!me) throw new Error("Login first.");
      const board = $("postBoard").value;
      const title = $("postTitle").value.trim();
      const location = $("postLocation").value.trim();
      const desc = $("postDesc").value.trim();
      const contact = $("postContact").value.trim();
      const status = $("postStatus").value;
      const files = [...($("postPhotos").files || [])];
      if(!title) throw new Error("Title is required.");
      if(!contact) throw new Error("Contact is required.");
      let price = 0;
      if(board !== "FREE"){
        const n = Number($("postPrice").value);
        if(!Number.isFinite(n) || n < 0.01) throw new Error("Please enter an amount over 0.01 for sale items.");
        price = n;
      }

      // UPLOAD FIRST so a failed image upload never creates duplicate Firestore posts
      let photoURLs = [];
      const tempPostId = editingId || `tmp_${Date.now()}`;
      if(files.length){
        try{
          photoURLs = await uploadPhotos(tempPostId, files);
        }catch(err){
          console.error(err);
          throw new Error("Image upload failed. In Firebase Console, enable Storage, publish storage.rules, and confirm the bucket exists.");
        }
      }

      if(editingId){
        const ref = db.collection("listings").doc(editingId);
        const snap = await ref.get();
        if(!snap.exists) throw new Error("Post not found.");
        const existing = snap.data();
        await ref.update({
          board, title, location, desc, contact, status, price,
          photoURLs: photoURLs.length ? photoURLs : (existing.photoURLs || []),
          updatedAtMs: Date.now()
        });
        setMsg("postMsg", "Post updated.", "ok");
      } else {
        await db.collection("listings").add({
          uid: me.uid,
          userEmail: me.email,
          displayName: displayName(),
          board, title, location, desc, contact, status, price,
          photoURLs,
          replies: [],
          reports: [],
          pinned: false,
          createdAtMs: Date.now()
        });
        setMsg("postMsg", "Post saved.", "ok");
      }

      hide("postModal");
      resetPostForm();
    }catch(e){
      console.error(e);
      setMsg("postMsg", e.message || "Post failed.", "error");
    }finally{
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  };

  $("grid").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if(!btn) return;
    const id = btn.dataset.id;
    const item = listings.find(x => x.id === id);
    if(!item) return;

    if(btn.dataset.act === "open") return openThread(id);
    if(btn.dataset.act === "edit") return fillPostForm(item);

    if(btn.dataset.act === "delete"){
      if(confirm("Delete this post?")){
        await db.collection("listings").doc(id).delete();
      }
      return;
    }

    if(btn.dataset.act === "sold"){
      await db.collection("listings").doc(id).update({
        status: item.status === "SOLD" ? "ACTIVE" : "SOLD"
      });
      return;
    }

    if(btn.dataset.act === "pin" && isAdmin()){
      await db.collection("listings").doc(id).update({ pinned: !item.pinned });
      return;
    }

    if(btn.dataset.act === "admin-delete" && isAdmin()){
      if(confirm("Admin delete this post?")){
        await db.collection("listings").doc(id).delete();
      }
    }
  });

  $("btnCloseThread").onclick = () => {
    hide("threadModal");
  };

  $("btnReply").onclick = async () => {
    try{
      if(!me) throw new Error("Login first.");
      const text = $("replyText").value.trim();
      if(!text) throw new Error("Type a reply first.");
      const ref = db.collection("listings").doc(openThreadId);
      const snap = await ref.get();
      if(!snap.exists) throw new Error("Listing not found.");
      const item = snap.data();
      const replies = [...(item.replies || []), {
        by: displayName(),
        uid: me.uid,
        text,
        atMs: Date.now()
      }];
      await ref.update({ replies });
      $("replyText").value = "";
      setMsg("replyMsg", "Reply posted.", "ok");
    }catch(e){
      setMsg("replyMsg", e.message || "Reply failed.", "error");
    }
  };

  $("btnReport").onclick = async () => {
    if(!openThreadId || !me) return;
    const ref = db.collection("listings").doc(openThreadId);
    const snap = await ref.get();
    if(!snap.exists) return;
    const item = snap.data();
    const reports = [...(item.reports || []), {
      by: displayName(),
      uid: me.uid,
      atMs: Date.now()
    }];
    await ref.update({ reports });
    alert("Post reported.");
  };

  ["searchBox","statusFilter","sortFilter"].forEach(id => $(id).addEventListener("input", renderListings));

  auth.onAuthStateChanged(async (user) => {
    if(!user){
      me = null;
      syncUI();
      return;
    }

    if(!user.emailVerified){
      setMsg("authMsg", "Please verify your email before using the marketplace.", "error");
      await auth.signOut();
      return;
    }

    const profileSnap = await db.collection("profiles").doc(user.uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : { name:(user.email || "").split("@")[0], banned:false };
    if(profile.banned){
      alert("Your access has been disabled.");
      await auth.signOut();
      return;
    }

    me = { uid:user.uid, email:user.email, name:profile.name || (user.email || "").split("@")[0] };
    syncUI();
    subscribeListings();
  });

  renderBoards();
  renderListings();
  togglePrice();
});