

import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
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
setPersistence(auth, browserLocalPersistence).catch((e)=>console.warn("Auth persistence warning:", e));
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
let isSavingPost = false;
let editingPostId = null;

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
    openCreatePost();
  });

  $("btnSavePost")?.addEventListener("click", handleSavePost);
  $("btnSendReply")?.addEventListener("click", handleSendReply);

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => hide(btn.dataset.close));
  });

  $("q")?.addEventListener("input", renderListings);
  $("st")?.addEventListener("change", renderListings);
  $("sort")?.addEventListener("change", renderListings);

  $("heroPostBtn")?.addEventListener("click", () => {
    if (!currentUser) {
      show("loginOverlay");
      return;
    }
    openCreatePost();
  });
  $("heroFreeBtn")?.addEventListener("click", () => {
    activeBoard = "FREE";
    if ($("boardPill")) $("boardPill").textContent = boardLabels[activeBoard] || "Free Items";
    if ($("feedTitle")) $("feedTitle").textContent = boardLabels[activeBoard] || "Free Items";
    renderBoards();
    renderListings();
  });

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
    } else if (action === "requestReactivation") {
      await handleRequestReactivation(id);
    } else if (action === "editPost") {
      openEditPost(id);
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

  if ($("adminLink")) { $("adminLink").style.display = loggedIn && currentProfile.isAdmin ? "inline-flex" : "none"; $("adminLink").setAttribute("href","admin.html"); }
  if ($("btnLogout")) $("btnLogout").style.display = loggedIn ? "inline-flex" : "none";
  if ($("btnNew")) $("btnNew").style.display = loggedIn ? "inline-flex" : "none";
  if ($("loginOverlay")) $("loginOverlay").style.display = loggedIn ? "none" : "flex";
  document.body.classList.toggle("auth-open", !loggedIn);
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
    alert(`${err?.code || "login_error"} | ${err?.message || "Login failed."}`);
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
    alert(`${err?.code || "signup_error"} | ${err?.message || "Signup failed."}`);
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
  const wrap = $("boards");
  if (!wrap) return;

  const counts = { ALL: listings.length };
  Object.keys(boardLabels).forEach((key) => {
    if (key !== "ALL") counts[key] = 0;
  });

  listings.forEach((item) => {
    counts[item.board] = (counts[item.board] || 0) + 1;
  });

  wrap.innerHTML = Object.entries(boardLabels).map(([key, label]) => `
    <button class="boardBtn ${activeBoard === key ? "active" : ""}" data-board="${key}" type="button">
      <span>${esc(label)}</span>
      <span class="pill">${counts[key] || 0}</span>
    </button>
  `).join("");

  wrap.querySelectorAll(".boardBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeBoard = btn.dataset.board;
      if ($("boardPill")) $("boardPill").textContent = boardLabels[activeBoard] || "All";
      if ($("feedTitle")) $("feedTitle").textContent = boardLabels[activeBoard] || "Marketplace";
      renderBoards();
      renderListings();
    });
  });

  if ($("boardPill")) $("boardPill").textContent = boardLabels[activeBoard] || "All";
}

function filteredListings() {
  const q = $("q")?.value.trim().toLowerCase() || "";
  const st = $("st")?.value || "ACTIVE";
  const sort = $("sort")?.value || "NEW";

  let data = listings.filter((item) => activeBoard === "ALL" || item.board === activeBoard);

  if (st !== "ALL") {
    data = data.filter((item) => (item.status || "ACTIVE") === st);
  }

  if (q) {
    data = data.filter((item) => {
      const hay = [
        item.title,
        item.description,
        item.location,
        item.contact,
        item.authorName
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  data.sort((a, b) => {
    const ap = Number(a.price || 0);
    const bp = Number(b.price || 0);
    if (sort === "OLD") return Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0);
    if (sort === "PRICE_ASC") return ap - bp;
    if (sort === "PRICE_DESC") return bp - ap;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });

  return data;
}

function formatPrice(v) {
  const n = Number(v || 0);
  if (!n) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(n);
}

function formatDate(ms) {
  const d = new Date(Number(ms || Date.now()));
  return d.toLocaleString();
}

function getListingImages(item) {
  const list = Array.isArray(item?.imageUrls) ? item.imageUrls.filter(Boolean) : [];
  const fallback = [item?.imageUrl, item?.photo].filter(Boolean);
  return [...new Set([...list, ...fallback])].slice(0, 10);
}

function canModify(item) {
  return !!currentUser && !!currentProfile && (currentProfile.isAdmin || currentUser.uid === item.uid);
}

function renderListings() {
  const wrap = $("cards");
  const empty = $("empty");
  if (!wrap || !empty) return;

  const data = filteredListings();

  if ($("countLine")) {
    $("countLine").textContent = `${data.length} shown | ${listings.length} total`;
  }

  if (!data.length) {
    wrap.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  wrap.innerHTML = data.map((item) => `
    <article class="card ${item.status === "SOLD" ? "isSold" : ""}">
      ${getListingImages(item)[0] ? `<img class="card-img" src="${esc(getListingImages(item)[0])}" alt="${esc(item.title)}" />` : ""}
      <div class="card-b">
        <div class="card-top">
          <div>
            <div class="card-title">${esc(item.title || "Untitled")}</div>
            <div class="meta">${esc(boardLabels[item.board] || item.board || "Listing")} | ${esc(item.authorName || item.authorEmail || "")}</div>
          </div>
          <div class="price">${esc(formatPrice(item.price))}</div>
        </div>
        <div class="desc">${esc(item.description || "")}</div>
        <div class="meta card-meta">
          <span>${esc(item.location || "No location")}</span>
          <span>${esc(item.contact || "No contact")}</span>
          <span>${esc(formatDate(item.createdAtMs))}</span>
          <span class="status ${item.status === "SOLD" ? "sold" : "active"}">${esc(item.status || "ACTIVE")}</span>
        </div>
        <div class="rowBtns">
          <button class="btn primary" data-action="openThread" data-id="${esc(item.id)}" type="button">Open</button>
          ${canModify(item) ? `<button class="btn ghost" data-action="editPost" data-id="${esc(item.id)}" type="button">Edit</button>` : ""}
          ${canModify(item) && item.status !== "SOLD" ? `<button class="btn" data-action="markSold" data-id="${esc(item.id)}" type="button">Mark Sold</button>` : ""}
          ${canModify(item) ? `<button class="btn danger" data-action="deletePost" data-id="${esc(item.id)}" type="button">Delete</button>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

async function handleSavePost() {
  if (!currentUser || !currentProfile) {
    alert("Please log in first.");
    return;
  }
  if (isSavingPost) return;

  const title = $("fTitle")?.value.trim();
  const description = $("fDesc")?.value.trim();
  const board = $("fBoard")?.value || "BUYSELL";
  const status = $("fStatus")?.value || "ACTIVE";
  const location = $("fLocation")?.value.trim() || "";
  const contact = $("fContact")?.value.trim() || "";
  const priceRaw = $("fPrice")?.value.trim() || "";
  const files = Array.from($("fPhoto")?.files || []);

  if (!title) {
    alert("Enter a title.");
    return;
  }
  if (!description) {
    alert("Enter a description.");
    return;
  }
  if (files.length > 10) {
    alert("You can upload up to 10 images.");
    return;
  }

  const existingItem = editingPostId ? listings.find((x) => x.id === editingPostId) : null;
  const existingImages = existingItem ? getListingImages(existingItem) : [];
  if (existingImages.length + files.length > 10) {
    alert("A post can have a maximum of 10 images.");
    return;
  }

  isSavingPost = true;
  const saveBtn = $("btnSavePost");
  const originalLabel = saveBtn?.textContent || "Post";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = editingPostId ? "Saving..." : "Posting...";
  }

  try {
    const uploadedUrls = [];
    for (const file of files) {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageRef = ref(storage, `listing-images/${currentUser.uid}/${safeName}`);
      await uploadBytes(storageRef, file);
      uploadedUrls.push(await getDownloadURL(storageRef));
    }

    const allImages = [...existingImages, ...uploadedUrls].slice(0, 10);
    const payload = {
      uid: currentUser.uid,
      authorEmail: currentUser.email || "",
      authorName: currentProfile.displayName || currentUser.email || "",
      displayName: currentProfile.displayName || currentUser.email || "",
      userEmail: currentUser.email || "",
      board,
      category: board,
      status,
      title,
      description,
      desc: description,
      location,
      contact,
      price: Number(priceRaw || 0),
      imageUrls: allImages,
      imageUrl: allImages[0] || "",
      photo: allImages[0] || "",
      updatedAt: serverTimestamp()
    };

    if (editingPostId && existingItem) {
      await updateDoc(doc(db, "listings", editingPostId), payload);
    } else {
      await addDoc(collection(db, "listings"), {
        ...payload,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
      });
    }

    clearPostForm();
    hide("postOverlay");
  } catch (err) {
    console.error(err);
    alert(`${err?.code || "post_error"} | ${err?.message || "Unable to save post."}`);
  } finally {
    isSavingPost = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  }
}

function clearPostForm() {
  editingPostId = null;
  ["fTitle", "fDesc", "fLocation", "fContact", "fPrice"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  if ($("fBoard")) $("fBoard").value = "FREE";
  if ($("fStatus")) $("fStatus").value = "ACTIVE";
  if ($("fPhoto")) $("fPhoto").value = "";
  if ($("postOverlayTitle")) $("postOverlayTitle").textContent = "Create Post";
  if ($("btnSavePost")) $("btnSavePost").textContent = "Post";
  if ($("postImageNote")) $("postImageNote").textContent = "Upload up to 10 images. If you edit a post and select more images, they will be added to the existing gallery.";
}

function populatePostForm(item) {
  const boardKey = item.board || item.category || "BUYSELL";
  if ($("fBoard")) $("fBoard").value = boardKey;
  if ($("fStatus")) $("fStatus").value = item.status || "ACTIVE";
  if ($("fTitle")) $("fTitle").value = item.title || "";
  if ($("fPrice")) $("fPrice").value = item.price ?? "";
  if ($("fLocation")) $("fLocation").value = item.location || "";
  if ($("fDesc")) $("fDesc").value = item.description || item.desc || "";
  if ($("fContact")) $("fContact").value = item.contact || "";
  if ($("fPhoto")) $("fPhoto").value = "";
}

function openCreatePost() {
  clearPostForm();
  show("postOverlay");
}

function openEditPost(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  editingPostId = id;
  populatePostForm(item);
  if ($("postOverlayTitle")) $("postOverlayTitle").textContent = "Edit Post";
  if ($("btnSavePost")) $("btnSavePost").textContent = "Save Changes";
  const existingCount = getListingImages(item).length;
  if ($("postImageNote")) $("postImageNote").textContent = `This post currently has ${existingCount} image${existingCount === 1 ? "" : "s"}. You can add more images up to a total of 10.`;
  show("postOverlay");
}

async function handleDeletePost(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;
  if (!confirm(`Delete "${item.title}"?`)) return;

  try {
    await deleteDoc(doc(db, "listings", id));
    if (activeThread?.id === id) hide("threadOverlay");
  } catch (err) {
    console.error(err);
    alert(err?.message || "Unable to delete post.");
  }
}

async function handleMarkSold(id) {
  const item = listings.find((x) => x.id === id);
  if (!item || !canModify(item)) return;

  try {
    await updateDoc(doc(db, "listings", id), {
      status: "SOLD",
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(err?.message || "Unable to update post.");
  }
}

async function openThread(id) {
  const item = listings.find((x) => x.id === id);
  if (!item) return;

  activeThread = item;

  if ($("threadTitle")) $("threadTitle").textContent = item.title || "Thread";
  if ($("threadMeta")) {
    $("threadMeta").textContent = `${boardLabels[item.board] || item.board} | ${item.authorName || item.authorEmail || ""} | ${formatDate(item.createdAtMs)}`;
  }

  if ($("threadBody")) {
    const images = getListingImages(item);
    const gallery = images.length
      ? `<div class="thread-gallery">${images.map((src) => `<img class="thread-img" src="${esc(src)}" alt="${esc(item.title)}" />`).join("")}</div>`
      : "";
    $("threadBody").innerHTML = `
      ${gallery}
      <div class="threadText">${esc(item.description || "")}</div>
      <div class="meta" style="margin-top:10px;">Location: ${esc(item.location || "-")} | Contact: ${esc(item.contact || "-")} | Price: ${esc(formatPrice(item.price))}</div>
    `;
  }

  if ($("threadReplies")) $("threadReplies").innerHTML = `<div class="note">Loading replies...</div>`;
  if ($("replyText")) $("replyText").value = "";

  show("threadOverlay");

  if (repliesUnsub) repliesUnsub();

  const qRef = query(collection(db, "listings", id, "replies"), orderBy("createdAtMs", "asc"));
  repliesUnsub = onSnapshot(qRef, (snap) => {
    const replies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderReplies(replies);
  }, (err) => {
    console.error(err);
    if ($("threadReplies")) $("threadReplies").innerHTML = `<div class="note">Unable to load replies.</div>`;
  });
}

function renderReplies(replies) {
  const wrap = $("threadReplies");
  if (!wrap) return;

  if (!replies.length) {
    wrap.innerHTML = `<div class="note">No replies yet.</div>`;
    return;
  }

  wrap.innerHTML = replies.map((r) => `
    <div class="reply">
      <div class="reply-top">
        <strong>${esc(r.authorName || r.authorEmail || "Unknown")}</strong>
        <span class="meta">${esc(formatDate(r.createdAtMs))}</span>
      </div>
      <div>${esc(r.text || "")}</div>
    </div>
  `).join("");
}

async function handleSendReply() {
  if (!currentUser || !currentProfile || !activeThread) {
    alert("Open a thread first.");
    return;
  }

  const text = $("replyText")?.value.trim();
  if (!text) {
    alert("Write a reply first.");
    return;
  }

  try {
    await addDoc(collection(db, "listings", activeThread.id, "replies"), {
      uid: currentUser.uid,
      authorEmail: currentUser.email || "",
      authorName: currentProfile.displayName || currentUser.email || "",
      text,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    if ($("replyText")) $("replyText").value = "";
  } catch (err) {
    console.error(err);
    alert(err?.message || "Unable to send reply.");
  }
}
