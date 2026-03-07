
import {firebaseConfig,ADMIN_EMAILS} from "./firebase-config.js"

import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,onAuthStateChanged,signOut}

from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

import {getFirestore,collection,addDoc,onSnapshot,serverTimestamp,updateDoc,doc}

from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"

import {getStorage,ref,uploadBytes,getDownloadURL}

from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"


const app=initializeApp(firebaseConfig)
const auth=getAuth(app)
const db=getFirestore(app)
const storage=getStorage(app)

loginBtn.onclick=()=>signInWithEmailAndPassword(auth,emailInput.value,passwordInput.value)

signupBtn.onclick=()=>createUserWithEmailAndPassword(auth,emailInput.value,passwordInput.value)

resetBtn.onclick=()=>sendPasswordResetEmail(auth,emailInput.value)

logoutBtn.onclick=()=>signOut(auth)

marketBtn.onclick=()=>{

marketplace.style.display="grid"
forum.style.display="none"

}

forumBtn.onclick=()=>{

marketplace.style.display="none"
forum.style.display="block"

}

createPostBtn.onclick=()=>postModal.style.display="block"

closeModalBtn.onclick=()=>postModal.style.display="none"

publishPostBtn.onclick=async()=>{

let imageUrl=""

const file=imageUpload.files[0]

if(file){

const storageRef=ref(storage,"posts/"+Date.now()+"_"+file.name)

await uploadBytes(storageRef,file)

imageUrl=await getDownloadURL(storageRef)

}

await addDoc(collection(db,"posts"),{

title:titleInput.value,
desc:descInput.value,
price:priceInput.value||"FREE",
image:imageUrl,
owner:auth.currentUser.email,
status:"active",
created:serverTimestamp()

})

postModal.style.display="none"

}

onAuthStateChanged(auth,user=>{

if(user){

loginSection.style.display="none"
appSection.style.display="block"

if(ADMIN_EMAILS.includes(user.email)){
adminBtn.style.display="inline-block"
}

loadPosts()

}

})

function loadPosts(){

onSnapshot(collection(db,"posts"),snapshot=>{

marketplace.innerHTML=""

snapshot.forEach(d=>{

const p=d.data()

marketplace.innerHTML+=`

<div class="card">

<img src="${p.image||""}">

<div class="cardBody">

<h3>${p.title}</h3>

<p>${p.desc}</p>

<b>${p.price}</b>

<button onclick="markSold('${d.id}')">Mark Sold</button>

</div>

</div>

`

})

})

}

window.markSold=async(id)=>{

await updateDoc(doc(db,"posts",id),{status:"sold"})

}
