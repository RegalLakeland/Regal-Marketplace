
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {getFirestore,collection,addDoc,onSnapshot,deleteDoc,doc} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {getStorage,ref,uploadBytes,getDownloadURL} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const app=initializeApp(window.firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const storage=getStorage(app);

const loginBox=document.getElementById("loginBox");
const market=document.getElementById("marketplace");
const postsDiv=document.getElementById("posts");

document.getElementById("loginBtn").onclick=()=>{
signInWithEmailAndPassword(auth,email.value,password.value);
};

document.getElementById("signupBtn").onclick=()=>{
createUserWithEmailAndPassword(auth,email.value,password.value);
};

document.getElementById("logoutBtn").onclick=()=>{
signOut(auth);
};

onAuthStateChanged(auth,user=>{
if(user){
loginBox.style.display="none";
market.style.display="block";
logoutBtn.style.display="inline-block";
loadPosts();
}else{
loginBox.style.display="block";
market.style.display="none";
logoutBtn.style.display="none";
}
});

postBtn.onclick=async()=>{

let imgURL="";

if(image.files[0]){
const r=ref(storage,"images/"+Date.now());
await uploadBytes(r,image.files[0]);
imgURL=await getDownloadURL(r);
}

await addDoc(collection(db,"posts"),{
title:title.value,
price:price.value,
description:description.value,
image:imgURL
});

};

function loadPosts(){

onSnapshot(collection(db,"posts"),snap=>{

postsDiv.innerHTML="";

snap.forEach(d=>{

const p=d.data();

const div=document.createElement("div");
div.className="post";

div.innerHTML=`
<h3>${p.title}</h3>
<p>${p.price}</p>
<p>${p.description}</p>
${p.image?'<img src="'+p.image+'" width="200">':""}
<button data="${d.id}">Delete</button>
`;

div.querySelector("button").onclick=()=>{
deleteDoc(doc(db,"posts",d.id));
};

postsDiv.appendChild(div);

});

});

}
