
const postsContainer = document.getElementById("posts")
const modal = document.getElementById("postModal")

const boards = document.querySelectorAll("#boards li")

let posts = JSON.parse(localStorage.getItem("posts")||"[]")

function render(board="all"){
postsContainer.innerHTML=""

posts.filter(p=> board==="all" || p.board===board).forEach(p=>{

let card=document.createElement("div")
card.className="card"

card.innerHTML=`
<h3>${p.title}</h3>
<div>$${p.price||""}</div>
<p>${p.desc}</p>
<small>${p.board}</small>
<div class="comments"></div>
<input placeholder="reply">
`

postsContainer.appendChild(card)

})
}

boards.forEach(b=>{
b.onclick=()=>{

boards.forEach(x=>x.classList.remove("active"))
b.classList.add("active")

render(b.dataset.board)

}
})

document.getElementById("newPost").onclick=()=>{
modal.classList.remove("hidden")
}

document.getElementById("closePost").onclick=()=>{
modal.classList.add("hidden")
}

document.getElementById("savePost").onclick=()=>{

let post={
title:document.getElementById("title").value,
price:document.getElementById("price").value,
desc:document.getElementById("desc").value,
board:document.getElementById("boardSelect").value
}

posts.unshift(post)
localStorage.setItem("posts",JSON.stringify(posts))

modal.classList.add("hidden")
render()

}

render()
