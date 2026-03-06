const ADMIN_SET = new Set(ADMIN_EMAILS.map(x => x.toLowerCase()));

function esc(v){
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if(!user || !ADMIN_SET.has(String(user.email || "").toLowerCase())){
      document.getElementById("adminUser").textContent = "Admin access only";
      document.getElementById("postAdminWrap").innerHTML = '<div class="small-note">Log in on the main page using an admin work email first.</div>';
      document.getElementById("userAdminWrap").innerHTML = '<div class="small-note">Allowed admin emails are configured in firebase-config.js.</div>';
      return;
    }

    document.getElementById("adminUser").textContent = user.email + " • Admin";

    db.collection("listings").orderBy("createdAtMs", "desc").onSnapshot((snap) => {
      const posts = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      document.getElementById("statPosts").textContent = String(posts.length);
      document.getElementById("statReports").textContent = String(posts.reduce((n,p) => n + ((p.reports || []).length), 0));
      document.getElementById("statPinned").textContent = String(posts.filter(p => p.pinned).length);

      let html = "<table><thead><tr><th>Title</th><th>By</th><th>Status</th><th>Reports</th><th></th></tr></thead><tbody>";
      posts.forEach(p => {
        html += `<tr>
          <td>${esc(p.title || "")}${p.pinned ? " 📌" : ""}</td>
          <td>${esc(p.displayName || p.userEmail || "")}</td>
          <td>${esc(p.status || "ACTIVE")}</td>
          <td>${(p.reports || []).length}</td>
          <td>
            <button class="btn pinBtn" data-id="${esc(p.id)}">${p.pinned ? "Unpin" : "Pin"}</button>
            <button class="btn danger delBtn" data-id="${esc(p.id)}">Delete</button>
          </td>
        </tr>`;
      });
      html += "</tbody></table>";
      document.getElementById("postAdminWrap").innerHTML = html;

      document.querySelectorAll(".pinBtn").forEach(btn => {
        btn.onclick = async () => {
          const post = posts.find(p => p.id === btn.dataset.id);
          if(post) await db.collection("listings").doc(post.id).update({ pinned: !post.pinned });
        };
      });
      document.querySelectorAll(".delBtn").forEach(btn => {
        btn.onclick = async () => {
          if(confirm("Delete this post?")) await db.collection("listings").doc(btn.dataset.id).delete();
        };
      });
    });

    db.collection("profiles").orderBy("createdAtMs", "desc").onSnapshot((snap) => {
      const users = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      document.getElementById("statUsers").textContent = String(users.length);

      let html = "<table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>";
      users.forEach(u => {
        html += `<tr>
          <td>${esc(u.name || "")}</td>
          <td>${esc(u.email || "")}</td>
          <td>${u.banned ? "BANNED" : "ACTIVE"}</td>
          <td><button class="btn ${u.banned ? "" : "danger"} banBtn" data-id="${esc(u.id)}" data-ban="${u.banned ? "0" : "1"}">${u.banned ? "Unban" : "Ban"}</button></td>
        </tr>`;
      });
      html += "</tbody></table>";
      document.getElementById("userAdminWrap").innerHTML = html;

      document.querySelectorAll(".banBtn").forEach(btn => {
        btn.onclick = async () => {
          await db.collection("profiles").doc(btn.dataset.id).set({
            banned: btn.dataset.ban === "1"
          }, { merge:true });
        };
      });
    });
  });
});
