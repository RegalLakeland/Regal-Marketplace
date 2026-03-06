
import {firebaseConfig, ADMIN_EMAILS} from './firebase-config.js'

import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
import {getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
import {getFirestore,collection,addDoc,onSnapshot,serverTimestamp,doc,deleteDoc,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
import {getStorage,ref,uploadBytes,getDownloadURL} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"

const app=initializeApp(firebaseConfig)
const auth=getAuth(app)
const db=getFirestore(app)
const storage=getStorage(app)

const email=document.getElementById("email")
const password=document.getElementById("password")

loginBtn.onclick=()=>signInWithEmailAndPassword(auth,email.value,password.value)
signupBtn.onclick=()=>createUserWithEmailAndPassword(auth,email.value,password.value)
resetBtn.onclick=()=>sendPasswordResetEmail(auth,email.value)
logoutBtn.onclick=()=>signOut(auth)

createPostBtn.onclick=()=>postModal.style.display="block"

function closeModal(){
postModal.style.display="none"
}

window.closeModal=closeModal

publishPost.onclick=async()=>{

const title=document.getElementById("title").value
const desc=document.getElementById("desc").value
const price=document.getElementById("price").value || "FREE"
const files=imageUpload.files

let imageUrl=""

if(files.length){

const file=files[0]
const r=ref(storage,"posts/"+Date.now()+"_"+file.name)

await uploadBytes(r,file)

imageUrl=await getDownloadURL(r)

}

await addDoc(collection(db,"posts"),{
title,
desc,
price,
image:imageUrl,
created:serverTimestamp(),
owner:auth.currentUser.email
})

closeModal()

}

onAuthStateChanged(auth,user=>{

if(user){

authArea.style.display="none"
appArea.style.display="block"

userDisplay.innerText=user.email

if(ADMIN_EMAILS.includes(user.email)){
adminBtn.style.display="inline-block"
}

loadPosts()

}

})

function loadPosts(){

onSnapshot(collection(db,"posts"),snap=>{

marketplace.innerHTML=""

snap.forEach(d=>{

const p=d.data()

marketplace.innerHTML+=`
<div class="card">

<img src="${p.image||''}">

<div class="cardBody">

<h3>${p.title}</h3>

<p>${p.desc}</p>

<b>${p.price}</b>

<br><br>

<button onclick="reply('${d.id}')">Reply</button>

${p.owner==auth.currentUser.email ? `<button onclick="edit('${d.id}')">Edit</button>` : ""}

${ADMIN_EMAILS.includes(auth.currentUser.email) ? `<button onclick="del('${d.id}')">Delete</button>` : ""}

</div>

</div>
`

})

})

}

window.del=async(id)=>{

await deleteDoc(doc(db,"posts",id))

}

