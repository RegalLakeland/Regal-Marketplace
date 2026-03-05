let posts = [];

function login(){
document.getElementById("postArea").style.display="block"
}

function signup(){
alert("Account created (demo build)")
}

function createPost(){

let title=document.getElementById("title").value
let price=document.getElementById("price").value
let desc=document.getElementById("desc").value

let post={title,price,desc}

posts.push(post)

renderPosts()
}

function renderPosts(){

let html=""

posts.forEach(p=>{

html+=`
<div class="post">
<b>${p.title}</b><br>
Price: ${p.price}<br>
${p.desc}
</div>
`

})

document.getElementById("posts").innerHTML=html

}
