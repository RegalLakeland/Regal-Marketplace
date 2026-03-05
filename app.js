
let posts = JSON.parse(localStorage.getItem("posts") || "[]")

let username = localStorage.getItem("username")

if(!username){
username = prompt("Enter your name")
localStorage.setItem("username", username)
}

document.getElementById("username").innerText = username

const feed = document.getElementById("feed")

function render(){

feed.innerHTML = ""

posts.forEach(p=>{

let card = document.createElement("div")
card.className="post"

card.innerHTML=`
<h3>${p.title}</h3>
<div>$${p.price||""}</div>
<p>${p.desc}</p>
<button onclick="openThread('${p.id}')">Open Thread</button>
`

feed.appendChild(card)

})

}

render()

postBtn.onclick = ()=>{
postModal.classList.remove("hidden")
}

function closePost(){
postModal.classList.add("hidden")
}

function createPost(){

let post={
id:Date.now().toString(),
title:title.value,
price:price.value,
desc:desc.value,
comments:[]
}

posts.push(post)

localStorage.setItem("posts",JSON.stringify(posts))

closePost()
render()

}

let currentThread=null

function openThread(id){

currentThread=id

let post = posts.find(p=>p.id==id)

threadTitle.innerText=post.title

let html=""

post.comments.forEach(c=>{

html+=`
<div class="comment">
<b>${c.user}</b>
<div>${c.text}</div>
</div>
`

})

threadComments.innerHTML=html

threadModal.classList.remove("hidden")

}

function closeThread(){
threadModal.classList.add("hidden")
}

function sendReply(){

let txt = replyText.value

let post = posts.find(p=>p.id==currentThread)

post.comments.push({
user:username,
text:txt
})

localStorage.setItem("posts",JSON.stringify(posts))

openThread(currentThread)

}
