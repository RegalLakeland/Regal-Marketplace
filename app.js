
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
getDocs
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

const loginOverlay = document.getElementById("loginOverlay")
const postOverlay = document.getElementById("postOverlay")
const cards = document.getElementById("cards")

document.getElementById("btnLogin").onclick = async () => {

const email = document.getElementById("loginEmail").value
const pass = document.getElementById("loginPassword").value

try{

await signInWithEmailAndPassword(auth,email,pass)

}catch(e){

alert("Login failed")

}

}

document.getElementById("btnLogout").onclick = () => signOut(auth)

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

document.getElementById("btnNew").onclick = () => {

postOverlay.style.display="flex"

}

document.getElementById("btnSave").onclick = async ()=>{

let imageURL=""

const file=document.getElementById("photo").files[0]

if(file){

const storageRef = ref(storage,"images/"+Date.now())

await uploadBytes(storageRef,file)

imageURL = await getDownloadURL(storageRef)

}

await addDoc(collection(db,"posts"),{

title:document.getElementById("title").value,
price:document.getElementById("price").value,
desc:document.getElementById("desc").value,
image:imageURL,
user:currentUser.email

})

postOverlay.style.display="none"

loadPosts()

}

async function loadPosts(){

cards.innerHTML=""

const snap = await getDocs(collection(db,"posts"))

snap.forEach(doc=>{

const d = doc.data()

const card=document.createElement("div")

card.className="card"

card.innerHTML=`

${d.image ? `<img src="${d.image}">` : ""}

<div class="card-body">

<h3>${d.title}</h3>

<b>$${d.price||""}</b>

<p>${d.desc}</p>

<small>Posted by ${d.user}</small>

</div>
`

cards.appendChild(card)

})

}
