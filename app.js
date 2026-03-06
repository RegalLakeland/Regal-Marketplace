
let posts=[];

function login(){
alert("Firebase login will work after you paste your firebase keys in firebase-config.js");
}

function signup(){
alert("Account creation will work once Firebase config is added.");
}

function resetPassword(){
alert("Password reset email will work after Firebase config.");
}

function createPost(){

let title=document.getElementById("title").value;
let price=document.getElementById("price").value;
let desc=document.getElementById("desc").value;

let post={title,price,desc};
posts.push(post);

renderPosts();
}

function renderPosts(){

let feed=document.getElementById("feed");
feed.innerHTML="";

posts.forEach(p=>{

let card=document.createElement("div");
card.className="card";

card.innerHTML=`
<h3>${p.title}</h3>
<p>$${p.price}</p>
<p>${p.desc}</p>
`;

feed.appendChild(card);

});

}
