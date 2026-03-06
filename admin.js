const $ = (id) => document.getElementById(id);
const ADMIN_EMAILS = new Set([
  "michael.h@regallakeland.com",
  "janni.r@regallakeland.com",
  "chrissy.h@regallakeland.com",
  "amy.m@regallakeland.com"
]);
function getUsers(){ try{return JSON.parse(localStorage.getItem("rm_users")||"[]")}catch{return []} }
function setUsers(v){ localStorage.setItem("rm_users", JSON.stringify(v)); }
function getPosts(){ try{return JSON.parse(localStorage.getItem("rm_posts")||"[]")}catch{return []} }
function setPosts(v){ localStorage.setItem("rm_posts", JSON.stringify(v)); }
function getSession(){ try{return JSON.parse(localStorage.getItem("rm_session")||"null")}catch{return null} }
const esc = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

document.addEventListener("DOMContentLoaded", () => {
  const me = getSession();
  if(!me || !ADMIN_EMAILS.has(String(me.email || "").toLowerCase())){
    $("adminUser").textContent = "Admin access only";
    $("postAdminWrap").innerHTML = '<div class="small-note">Log in with an admin email on the main site first.</div>';
    $("userAdminWrap").innerHTML = '<div class="small-note">Allowed admin emails are configured in admin.js.</div>';
    return;
  }
  $("adminUser").textContent = me.email + " • Admin";

  function render(){
    const posts = getPosts();
    const users = getUsers();
    $("statPosts").textContent = String(posts.length);
    $("statUsers").textContent = String(users.length);
    $("statReports").textContent = String(posts.reduce((n,p)=>n + ((p.reports || []).length), 0));
    $("statPinned").textContent = String(posts.filter(p=>p.pinned).length);

    let postHtml = "<table><thead><tr><th>Title</th><th>By</th><th>Status</th><th>Reports</th><th></th></tr></thead><tbody>";
    for(const p of posts){
      postHtml += `<tr>
        <td>${esc(p.title || "")}${p.pinned ? " 📌" : ""}</td>
        <td>${esc(p.displayName || p.userEmail || "")}</td>
        <td>${esc(p.status || "ACTIVE")}</td>
        <td>${(p.reports || []).length}</td>
        <td>
          <button class="btn pinBtn" data-id="${esc(p.id)}">${p.pinned ? "Unpin" : "Pin"}</button>
          <button class="btn danger delBtn" data-id="${esc(p.id)}">Delete</button>
        </td>
      </tr>`;
    }
    postHtml += "</tbody></table>";
    $("postAdminWrap").innerHTML = postHtml;

    let userHtml = "<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>";
    for(const u of users){
      userHtml += `<tr>
        <td>${esc(u.name || "")}</td>
        <td>${esc(u.email || "")}</td>
        <td>${u.banned ? "BANNED" : "ACTIVE"}</td>
        <td><button class="btn ${u.banned ? "" : "danger"} banBtn" data-id="${esc(u.uid)}" data-ban="${u.banned ? "0" : "1"}">${u.banned ? "Unban" : "Ban"}</button></td>
      </tr>`;
    }
    userHtml += "</tbody></table>";
    $("userAdminWrap").innerHTML = userHtml;

    document.querySelectorAll(".pinBtn").forEach(btn => {
      btn.onclick = () => {
        const next = getPosts().map(p => p.id === btn.dataset.id ? { ...p, pinned: !p.pinned } : p);
        setPosts(next);
        render();
      };
    });
    document.querySelectorAll(".delBtn").forEach(btn => {
      btn.onclick = () => {
        if(confirm("Delete this post?")){
          setPosts(getPosts().filter(p => p.id !== btn.dataset.id));
          render();
        }
      };
    });
    document.querySelectorAll(".banBtn").forEach(btn => {
      btn.onclick = () => {
        const next = getUsers().map(u => u.uid === btn.dataset.id ? { ...u, banned: btn.dataset.ban === "1" } : u);
        setUsers(next);
        render();
      };
    });
  }

  render();
});
