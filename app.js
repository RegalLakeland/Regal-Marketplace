
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
getAuth,
signInWithEmailAndPassword,
signOut,
onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
getFirestore,
collection,
addDoc,
getDocs,
doc,
updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
getStorage,
ref,
uploadBytes,
getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const firebaseConfig = {
apiKey: "AIzaSyB6IAiH6zILQKuJRuXc55Q4hEX8q6F2kxE",
authDomain: "regal-lakeland-marketplace.firebaseapp.com",
projectId: "regal-lakeland-marketplace",
storageBucket: "regal-lakeland-marketplace.appspot.com",
messagingSenderId: "1014346693296",
appId: "1:1014346693296:web:fc76118d1a8db347945975"
};

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)

let currentUser = null
let posts = []

const loginOverlay = document.getElementById("loginOverlay")
const postOverlay = document.getElementById("postOverlay")
const cards = document.getElementById("cards")

document.getElementById("btnLogin").onclick = async ()=>{

const email=document.getElementById("loginEmail").value
const pass=document.getElementById("loginPassword").value

try{

await signInWithEmailAndPassword(auth,email,pass)

}catch(e){

alert("Login failed")

}

}

document.getElementById("btnLogout").onclick=()=>signOut(auth)

onAuthStateChanged(auth,(user)=>{

if(!user){

loginOverlay.style.display="flex"
return

}

loginOverlay.style.display="none"

currentUser=user

document.getElementById("userEmail").innerText=user.email

loadPosts()

})

document.getElementById("btnNew").onclick=()=>{

postOverlay.style.display="flex"

}

document.getElementById("btnSave").onclick=async()=>{

let imageURL=""

const file=document.getElementById("photo").files[0]

if(file){

const storageRef=ref(storage,"images/"+Date.now())

await uploadBytes(storageRef,file)

imageURL=await getDownloadURL(storageRef)

}

await addDoc(collection(db,"posts"),{

title:document.getElementById("title").value,
price:document.getElementById("price").value,
desc:document.getElementById("desc").value,
board:document.getElementById("board").value,
image:imageURL,
user:currentUser.email,
replies:[]

})

postOverlay.style.display="none"

loadPosts()

}

async function loadPosts(){

cards.innerHTML=""

const snap=await getDocs(collection(db,"posts"))

posts=[]

snap.forEach(doc=>{

posts.push({id:doc.id,...doc.data()})

})

render(posts)

}

function render(list){

cards.innerHTML=""

list.forEach(p=>{

const card=document.createElement("div")

card.className="card"

card.innerHTML=`

${p.image?`<img src="${p.image}">`:""}

<div class="card-body">

<h3>${p.title}</h3>

<b>$${p.price||""}</b>

<p>${p.desc}</p>

<small>${p.board} • ${p.user}</small>

<div id="replies-${p.id}"></div>

<textarea id="reply-${p.id}" placeholder="Reply"></textarea>

<button onclick="reply('${p.id}')">Reply</button>

</div>
`

cards.appendChild(card)

})

}

window.reply=async(id)=>{

const text=document.getElementById("reply-"+id).value

const post=posts.find(p=>p.id===id)

post.replies.push({
user:currentUser.email,
text:text
})

await updateDoc(doc(db,"posts",id),{
replies:post.replies
})

loadPosts()

}

document.getElementById("search").oninput=(e)=>{

const q=e.target.value.toLowerCase()

render(posts.filter(p=>
(p.title+p.desc+p.user).toLowerCase().includes(q)
))

}

document.querySelectorAll(".board").forEach(btn=>{

btn.onclick=()=>{

const b=btn.dataset.board

if(b==="all") render(posts)
else render(posts.filter(p=>p.board===b))

}

})
