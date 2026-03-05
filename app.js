
const admins=[
"Michael.H@regallakeland.com",
"janni.r@regallakeland.com",
"chrissy.h@regallakeland.com",
"amy.m@regallakeland.com"
]

let posts=JSON.parse(localStorage.getItem("posts")||"[]")
let currentThread=null

function login(){
let email=document.getElementById("email").value
if(!email) return alert("Enter email")
localStorage.setItem("user",email)
startApp()
}

function logout(){
localStorage.removeItem("user")
location.reload()
}

function startApp(){
let user=localStorage.getItem("user")
if(!user) return

loginScreen.classList.add("hidden")
app.classList.remove("hidden")

userDisplay.innerText=user

if(admins.includes(user)){
adminLink.classList.remove("hidden")
}

render()
}

window.onload=startApp

function render(){
feed.innerHTML=""
posts.forEach(p=>{
let div=document.createElement("div")
div.className="post"

div.innerHTML=`
${p.image?`<img src="${p.image}">`:""}
<h3>${p.title}</h3>
<div>$${p.price||""}</div>
<p>${p.desc}</p>
<button onclick="openThread('${p.id}')">Open Thread</button>
`
feed.appendChild(div)
})
}

function openPost(){postModal.classList.remove("hidden")}
function closePost(){postModal.classList.add("hidden")}

function createPost(){
let file=imageUpload.files[0]
if(file){
let reader=new FileReader()
reader.onload=function(){savePost(reader.result)}
reader.readAsDataURL(file)
}else{
savePost(null)
}
}

function savePost(img){
let post={
id:Date.now().toString(),
title:title.value,
price:price.value,
desc:desc.value,
image:img,
comments:[]
}

posts.push(post)
localStorage.setItem("posts",JSON.stringify(posts))
closePost()
render()
}

function openThread(id){
currentThread=id
let post=posts.find(p=>p.id==id)
threadTitle.innerText=post.title
let html=""
post.comments.forEach(c=>{
html+=`<div class="comment"><b>${c.user}</b><div>${c.text}</div></div>`
})
threadComments.innerHTML=html
threadModal.classList.remove("hidden")
}

function closeThread(){threadModal.classList.add("hidden")}

function sendReply(){
let txt=replyText.value
let user=localStorage.getItem("user")
let post=posts.find(p=>p.id==currentThread)

post.comments.push({
user:user,
text:txt
})

localStorage.setItem("posts",JSON.stringify(posts))
openThread(currentThread)
}
