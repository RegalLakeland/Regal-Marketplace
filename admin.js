const ADMIN_SET = new Set(ADMIN_EMAILS.map(x => String(x).toLowerCase()));
function esc(v){ return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function formatDate(d){ return d ? new Date(d).toLocaleDateString() + " " + new Date(d).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—"; }
function $(id){ return document.getElementById(id); }

document.addEventListener('DOMContentLoaded',()=>{
  auth.onAuthStateChanged(async(user)=>{
    if(!user || !ADMIN_SET.has(String(user.email||"").toLowerCase())){
      $("adminUser").textContent='Admin access only';
      $("alertTable").innerHTML='<div class="empty-box">Log in on the main page using an admin work email first.</div>';
      $("postTable").innerHTML='<div class="empty-box">Admin-only area.</div>';
      $("userTable").innerHTML='<div class="empty-box">Admin-only area.</div>';
      return;
    }
    $("adminUser").textContent=user.email+' • Admin';
    db.collection('alerts').orderBy('createdAt','desc').onSnapshot(snap=>{
      const alerts=snap.docs.map(d=>({id:d.id,...d.data()}));
      $("statAlerts").textContent=String(alerts.length);
      $("alertTable").innerHTML = alerts.length ? `<table class="table"><thead><tr><th>Type</th><th>Title</th><th>Email</th><th>Date</th><th>Status</th></tr></thead><tbody>${alerts.map(a=>`<tr><td>${esc(a.kind)}</td><td>${esc(a.title||'')}</td><td>${esc(a.byEmail||'')}</td><td>${formatDate(a.createdAt)}</td><td>${esc(a.status||'')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-box">No moderation alerts.</div>';
    });
    db.collection('posts').orderBy('createdAt','desc').onSnapshot(snap=>{
      const posts=snap.docs.map(d=>({id:d.id,...d.data()}));
      $("statPosts").textContent=String(posts.length);
      $("postTable").innerHTML = posts.length ? `<table class="table"><thead><tr><th>Title</th><th>Section</th><th>Author</th><th>Status</th><th>Flags</th><th></th></tr></thead><tbody>${posts.map(p=>`<tr><td>${esc(p.title)}</td><td>${esc(p.sectionId)}</td><td>${esc(p.authorName)}</td><td>${esc(p.status||'ACTIVE')}</td><td>${p.flags?.profanity?'Profanity':''}</td><td><button class="btn danger post-del" data-id="${p.id}" type="button">Delete</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-box">No posts found.</div>';
      document.querySelectorAll('.post-del').forEach(btn=>btn.onclick=async()=>{ if(confirm('Delete this post?')) await db.collection('posts').doc(btn.dataset.id).delete(); });
    });
    db.collection('profiles').orderBy('createdAt','desc').onSnapshot(snap=>{
      const users=snap.docs.map(d=>({id:d.id,...d.data()}));
      $("statUsers").textContent=String(users.length);
      $("statBanned").textContent=String(users.filter(u=>u.banned).length);
      $("userTable").innerHTML = users.length ? `<table class="table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>IP</th><th>Status</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.usernameLower||'')}</td><td>${esc(u.email)}</td><td>${esc(u.ipAddress||'Requires backend capture')}</td><td>${u.banned?'BANNED':'ACTIVE'}</td><td><button class="btn ${u.banned?'':'danger'} user-ban" data-id="${u.id}" data-ban="${u.banned?'0':'1'}" type="button">${u.banned?'Unban':'Ban'}</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-box">No users found.</div>';
      document.querySelectorAll('.user-ban').forEach(btn=>btn.onclick=async()=>{ await db.collection('profiles').doc(btn.dataset.id).set({banned:btn.dataset.ban==='1'},{merge:true}); });
    });
  });
});
