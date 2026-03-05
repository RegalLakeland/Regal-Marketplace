
let posts=JSON.parse(localStorage.getItem("posts")||"[]")
const container=document.getElementById("adminPosts")

posts.forEach(p=>{
let div=document.createElement("div")
div.innerHTML=`<h3>${p.title}</h3><button onclick="deletePost('${p.id}')">Delete</button>`
container.appendChild(div)
})

function deletePost(id){
posts=posts.filter(p=>p.id!==id)
localStorage.setItem("posts",JSON.stringify(posts))
location.reload()
}
