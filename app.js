const STORAGE_KEY = "regal_forum_option1_data_v1";
const sectionGroups = [
  { title: "Marketplace", sections: [
    { id: "free-items", name: "Free Items", desc: "Post giveaways, free items, and curb alerts." },
    { id: "buy-sell", name: "Buy / Sell", desc: "Sell items to coworkers or look for something specific." },
    { id: "garage-sales", name: "Garage Sales", desc: "Weekend sales, moving sales, and neighborhood finds." }
  ]},
  { title: "Community", sections: [
    { id: "events", name: "Events", desc: "Birthdays, barbecues, outings, and employee meetups." },
    { id: "work-news", name: "Work News", desc: "Announcements, updates, reminders, and dealership info." },
    { id: "services", name: "Services", desc: "Promote side work, referrals, and help offered." }
  ]}
];
const seedData = { topics: [
  { id:"t1", sectionId:"free-items", title:"Free toddler bike in Lakeland", author:"Stacey M", price:"FREE", location:"Lakeland", contact:"Text Stacey in BDC", body:"Pink toddler bike in good shape. Free to any employee who can use it for their kid. First come first served.", createdAt:"2026-03-05T10:20:00", views:18, replies:[{ id:"r1", author:"Michael H", body:"Still available?", createdAt:"2026-03-05T10:45:00" }]},
  { id:"t2", sectionId:"buy-sell", title:"PS5 headset for sale", author:"Jordan T", price:"$45", location:"Regal Honda", contact:"jordan.t@regallakeland.com", body:"Barely used headset. Works great. I can bring it to work tomorrow if anyone wants it.", createdAt:"2026-03-05T08:10:00", views:31, replies:[{ id:"r2", author:"Amy M", body:"Can you hold it until Friday?", createdAt:"2026-03-05T09:02:00" }]},
  { id:"t3", sectionId:"events", title:"Friday lunch order thread", author:"Chrissy H", price:"N/A", location:"Main break room", contact:"See Chrissy at the desk", body:"Post what you want from lunch by 10:30 Friday so we can get one group order in.", createdAt:"2026-03-04T15:00:00", views:52, replies:[{ id:"r3", author:"Janni R", body:"Chicken caesar wrap for me.", createdAt:"2026-03-04T15:11:00" },{ id:"r4", author:"Michael H", body:"Double cheeseburger basket please.", createdAt:"2026-03-04T15:20:00" }]},
  { id:"t4", sectionId:"work-news", title:"Saturday team huddle moved to 8:15", author:"Management", price:"N/A", location:"Showroom", contact:"See Johnny", body:"Saturday huddle is being moved to 8:15 instead of 8:30. Please make sure your teams know.", createdAt:"2026-03-05T06:30:00", views:76, replies:[]}
]};
let store = loadStore();
let currentView = { type: "boards", sectionId: null, threadId: null };
let replyTargetId = null;

function loadStore(){ const raw = localStorage.getItem(STORAGE_KEY); if(!raw){ localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData)); return JSON.parse(JSON.stringify(seedData)); } try { return JSON.parse(raw); } catch { localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData)); return JSON.parse(JSON.stringify(seedData)); } }
function saveStore(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
function getSectionsFlat(){ return sectionGroups.flatMap(g => g.sections); }
function getSectionById(id){ return getSectionsFlat().find(s => s.id === id); }
function getTopicsBySection(sectionId){ return store.topics.filter(t => t.sectionId === sectionId).sort((a,b) => new Date(getLastActivity(b)) - new Date(getLastActivity(a))); }
function getTopicById(id){ return store.topics.find(t => t.id === id); }
function getLastReply(topic){ return topic.replies && topic.replies.length ? topic.replies[topic.replies.length - 1] : null; }
function getLastActivity(topic){ const reply = getLastReply(topic); return reply ? reply.createdAt : topic.createdAt; }
function formatDate(dateString){ const d = new Date(dateString); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function initials(name){ return String(name || "?").split(" ").filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join(""); }
function escapeHtml(value){ return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function renderBoards(){
  const app = document.getElementById("app");
  const groupsHtml = sectionGroups.map(group => {
    const rows = group.sections.map(section => {
      const topics = getTopicsBySection(section.id);
      const lastTopic = topics[0];
      const lastReply = lastTopic ? getLastReply(lastTopic) : null;
      return `
        <div class="board-row" data-section="${section.id}">
          <div class="board-main">
            <div class="avatar-circle">💬</div>
            <div>
              <div class="board-title">${escapeHtml(section.name)}</div>
              <div class="board-desc">${escapeHtml(section.desc)}</div>
            </div>
          </div>
          <div class="board-count">${topics.length}<span>threads</span></div>
          <div class="last-post">
            <div class="mini-avatar">${lastTopic ? initials(lastReply ? lastReply.author : lastTopic.author) : "—"}</div>
            <div>
              <div class="last-post-title">${lastTopic ? escapeHtml(lastTopic.title) : "No threads yet"}</div>
              <div class="last-post-meta">${lastTopic ? `${escapeHtml(lastReply ? lastReply.author : lastTopic.author)}, ${formatDate(getLastActivity(lastTopic))}` : "Start the first thread"}</div>
            </div>
          </div>
        </div>`;
    }).join("");
    return `<div class="section-group-title">${escapeHtml(group.title)}</div><div class="board-table">${rows}</div>`;
  }).join("");
  app.innerHTML = groupsHtml;
  app.querySelectorAll("[data-section]").forEach(row => {
    row.addEventListener("click", () => { currentView = { type: "section", sectionId: row.dataset.section, threadId: null }; render(); });
  });
}

function topicRowHtml(topic){
  const lastReply = getLastReply(topic);
  return `<div class="topic-row" data-thread="${topic.id}">
    <div class="topic-main">
      <div class="avatar-circle">💬</div>
      <div>
        <div class="topic-title">${escapeHtml(topic.title)}</div>
        <div class="topic-desc">${escapeHtml(topic.author)}, ${formatDate(topic.createdAt)} ${topic.price && topic.price !== "N/A" ? ` • ${escapeHtml(topic.price)}` : ""}</div>
      </div>
    </div>
    <div class="topic-stat">${topic.replies.length}<span>replies</span></div>
    <div class="topic-stat">${topic.views || 0}<span>views</span></div>
    <div class="last-message">
      <div class="mini-avatar">${initials(lastReply ? lastReply.author : topic.author)}</div>
      <div>
        <div class="last-message-title">${escapeHtml(lastReply ? lastReply.author : topic.author)}</div>
        <div class="last-message-meta">${formatDate(getLastActivity(topic))}</div>
      </div>
    </div>
  </div>`;
}

function bindTopicRows(sectionId){
  document.querySelectorAll("[data-thread]").forEach(row => {
    row.addEventListener("click", () => { currentView = { type: "thread", sectionId, threadId: row.dataset.thread }; render(); });
  });
}

function renderSection(sectionId){
  const app = document.getElementById("app");
  const section = getSectionById(sectionId);
  const topics = getTopicsBySection(sectionId);
  app.innerHTML = `
    <div class="breadcrumbs"><a href="#" id="crumbBoards">Boards</a> / ${escapeHtml(section.name)}</div>
    <div class="topic-header">
      <div><h2>${escapeHtml(section.name)}</h2><div class="subhead">${escapeHtml(section.desc)}</div></div>
      <div class="filters"><input id="topicSearch" placeholder="Search this section..." /></div>
    </div>
    <div class="topic-table" id="topicTable">${topics.length ? topics.map(topicRowHtml).join("") : `<div class="empty-box">No threads in this section yet.</div>`}</div>`;
  document.getElementById("crumbBoards").addEventListener("click", (e) => { e.preventDefault(); currentView = { type: "boards", sectionId: null, threadId: null }; render(); });
  bindTopicRows(sectionId);
  const search = document.getElementById("topicSearch");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const filtered = topics.filter(t => (t.title + " " + t.body + " " + t.author).toLowerCase().includes(q));
    document.getElementById("topicTable").innerHTML = filtered.length ? filtered.map(topicRowHtml).join("") : `<div class="empty-box">No matching threads found.</div>`;
    bindTopicRows(sectionId);
  });
}

function renderThread(threadId){
  const app = document.getElementById("app");
  const topic = getTopicById(threadId);
  const section = getSectionById(topic.sectionId);
  topic.views = (topic.views || 0) + 1; saveStore();
  const repliesHtml = topic.replies.length ? topic.replies.map(reply => `<div class="reply-card"><div class="reply-top"><div class="reply-author">${escapeHtml(reply.author)}</div><div class="reply-date">${formatDate(reply.createdAt)}</div></div><div class="reply-body">${escapeHtml(reply.body)}</div></div>`).join("") : `<div class="empty-box">No replies yet. Be the first to respond.</div>`;
  app.innerHTML = `
    <div class="breadcrumbs"><a href="#" id="crumbBoards">Boards</a> / <a href="#" id="crumbSection">${escapeHtml(section.name)}</a> / ${escapeHtml(topic.title)}</div>
    <div class="thread-card">
      <div class="thread-top">
        <div><div class="thread-title">${escapeHtml(topic.title)}</div><div class="meta-line">Started by ${escapeHtml(topic.author)} • ${formatDate(topic.createdAt)}</div></div>
        <div class="price-pill">${escapeHtml(topic.price || "N/A")}</div>
      </div>
      <div class="thread-body">${escapeHtml(topic.body)}</div>
      <div class="thread-info-grid">
        <div class="info-card"><div class="info-label">Location</div><div class="info-value">${escapeHtml(topic.location || "Not listed")}</div></div>
        <div class="info-card"><div class="info-label">Contact</div><div class="info-value">${escapeHtml(topic.contact || "Not listed")}</div></div>
        <div class="info-card"><div class="info-label">Views / Replies</div><div class="info-value">${topic.views || 0} views • ${topic.replies.length} replies</div></div>
      </div>
      <div class="card-actions"><button id="replyBtn" class="primary-btn">Reply</button><button id="backToSectionBtn" class="ghost-btn">Back to ${escapeHtml(section.name)}</button></div>
    </div>
    <div class="replies-wrap"><div class="replies-title">Replies</div>${repliesHtml}</div>`;
  document.getElementById("crumbBoards").addEventListener("click", (e) => { e.preventDefault(); currentView = { type: "boards", sectionId: null, threadId: null }; render(); });
  document.getElementById("crumbSection").addEventListener("click", (e) => { e.preventDefault(); currentView = { type: "section", sectionId: section.id, threadId: null }; render(); });
  document.getElementById("backToSectionBtn").addEventListener("click", () => { currentView = { type: "section", sectionId: section.id, threadId: null }; render(); });
  document.getElementById("replyBtn").addEventListener("click", () => { replyTargetId = topic.id; document.getElementById("replyModal").classList.remove("hidden"); });
}

function populateComposeSections(){ document.getElementById("composeSection").innerHTML = getSectionsFlat().map(s => `<option value="${s.id}">${s.name}</option>`).join(""); }

function createThread(){
  const sectionId = document.getElementById("composeSection").value;
  const author = document.getElementById("composeAuthor").value.trim();
  const title = document.getElementById("composeTitle").value.trim();
  const body = document.getElementById("composeBody").value.trim();
  const price = document.getElementById("composePrice").value.trim() || "FREE";
  const location = document.getElementById("composeLocation").value.trim() || "Lakeland";
  const contact = document.getElementById("composeContact").value.trim();
  if(!author || !title || !body){ alert("Please fill out name, title, and description."); return; }
  store.topics.unshift({ id:"t"+Date.now(), sectionId, title, author, price, location, contact, body, createdAt:new Date().toISOString(), views:0, replies:[] });
  saveStore();
  document.getElementById("composeAuthor").value = "";
  document.getElementById("composeTitle").value = "";
  document.getElementById("composeBody").value = "";
  document.getElementById("composePrice").value = "";
  document.getElementById("composeLocation").value = "";
  document.getElementById("composeContact").value = "";
  document.getElementById("composeModal").classList.add("hidden");
  currentView = { type: "section", sectionId, threadId: null };
  render();
}

function createReply(){
  const author = document.getElementById("replyAuthor").value.trim();
  const body = document.getElementById("replyBody").value.trim();
  if(!author || !body || !replyTargetId){ alert("Please enter your name and reply."); return; }
  const topic = getTopicById(replyTargetId);
  topic.replies.push({ id:"r"+Date.now(), author, body, createdAt:new Date().toISOString() });
  saveStore();
  document.getElementById("replyAuthor").value = "";
  document.getElementById("replyBody").value = "";
  document.getElementById("replyModal").classList.add("hidden");
  renderThread(replyTargetId);
}

function render(){ if(currentView.type === "boards") renderBoards(); else if(currentView.type === "section") renderSection(currentView.sectionId); else if(currentView.type === "thread") renderThread(currentView.threadId); }

document.getElementById("homeBtn").addEventListener("click", () => { currentView = { type: "boards", sectionId: null, threadId: null }; render(); });
document.getElementById("newTopicBtn").addEventListener("click", () => { populateComposeSections(); document.getElementById("composeModal").classList.remove("hidden"); });
document.getElementById("closeComposeBtn").addEventListener("click", () => { document.getElementById("composeModal").classList.add("hidden"); });
document.getElementById("saveTopicBtn").addEventListener("click", createThread);
document.getElementById("closeReplyBtn").addEventListener("click", () => { document.getElementById("replyModal").classList.add("hidden"); });
document.getElementById("saveReplyBtn").addEventListener("click", createReply);
render();
