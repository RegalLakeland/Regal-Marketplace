
const admins = [
"janni.r@regallakeland.com",
"michael.h@regallakeland.com"
];

function signup(){

let first=document.getElementById("first").value;
let last=document.getElementById("last").value;
let email=document.getElementById("email").value;
let pass=document.getElementById("password").value;

if(!email.endsWith("@regallakeland.com")){
alert("Must use Regal Lakeland email");
return;
}

auth.createUserWithEmailAndPassword(email,pass)
.then(user=>{

db.collection("users").doc(user.user.uid).set({
first:first,
last:last,
email:email,
created:Date.now(),
banned:false
});

alert("Account created");

})
.catch(e=>alert(e.message));
}

function login(){

let email=document.getElementById("loginEmail").value;
let pass=document.getElementById("loginPass").value;

auth.signInWithEmailAndPassword(email,pass)
.catch(e=>alert(e.message));

}

auth.onAuthStateChanged(user=>{

if(user){

document.getElementById("loginBox").style.display="none";
document.getElementById("app").style.display="block";

loadPosts();

}

});

function logout(){
auth.signOut();
location.reload();
}

function openPost(){

document.getElementById("postPanel").style.display="block";

}

function createPost(){

let title=document.getElementById("title").value;
let desc=document.getElementById("desc").value;
let price=document.getElementById("price").value;
let file=document.getElementById("photo").files[0];

let ref=storage.ref("posts/"+Date.now()+file.name);

ref.put(file).then(snapshot=>{

snapshot.ref.getDownloadURL().then(url=>{

db.collection("posts").add({
title:title,
desc:desc,
price:price,
image:url,
created:Date.now(),
author:auth.currentUser.email
});

});

});

}

function loadPosts(){

db.collection("posts").orderBy("created","desc")
.onSnapshot(snap=>{

let html="";

snap.forEach(doc=>{

let p=doc.data();

html+=`

<div class="post">

<h3>${p.title}</h3>
<p>${p.desc}</p>
<p>Price: ${p.price}</p>
<img src="${p.image}" width="200">
<p>Posted by ${p.author}</p>

</div>

`;

});

document.getElementById("posts").innerHTML=html;

});

}
