
const ADMIN_EMAILS=[
"janni.r@regallakeland.com",
"michael.h@regallakeland.com"
]

let posts=[]
let currentUser=null

function signup(){

let first=document.getElementById("first").value
let last=document.getElementById("last").value
let email=document.getElementById("email").value
let pass=document.getElementById("pass").value

if(!email.endsWith("@regallakeland.com")){
alert("Must use Regal Lakeland email")
return
}

localStorage.setItem("user_"+email,JSON.stringify({first,last,email,pass,banned:false}))

alert("Account created")
}

function login(){

let email=document.getElementById("loginEmail").value
let pass=document.getElementById("loginPass").value

let data=JSON.parse(localStorage.getItem("user_"+email))

if(!data){alert("No account");return}

if(data.pass!=pass){alert("Wrong password");return}

if(data.banned){alert("User banned");return}

currentUser=data

document.getElementById("loginBox").style.display="none"
document.getElementById("app").style.display="block"

renderPosts()
}

function createPost(){

let title=document.getElementById("title").value
let desc=document.getElementById("desc").value
let price=document.getElementById("price").value

let post={
id:Date.now(),
title,
desc,
price,
author:currentUser.first+" "+currentUser.last,
replies:[]
}

posts.push(post)

renderPosts()
}

function renderPosts(){

let html=""

posts.forEach(p=>{

html+=`<div class="card">

<b>${p.title}</b><br>
${p.desc}<br>
Price: ${p.price||"Free"}<br>
By: ${p.author}

<br><br>
<input id="r_${p.id}" placeholder="Reply">
<button onclick="reply(${p.id})">Reply</button>
`

p.replies.forEach(r=>{
html+=`<div style="margin-left:20px">${r}</div>`
})

html+="</div>"

})

document.getElementById("posts").innerHTML=html
}

function reply(id){

let text=document.getElementById("r_"+id).value
let post=posts.find(p=>p.id==id)

post.replies.push(currentUser.first+": "+text)

renderPosts()
}
