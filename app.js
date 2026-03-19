// FINAL STABLE APP.JS

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function showPending(){
  let o=document.getElementById("pendingOverlay");
  if(o) return;
  o=document.createElement("div");
  o.id="pendingOverlay";
  o.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;z-index:9999;";
  o.innerHTML="<div><h2>Pending Approval</h2><p>Waiting for admin...</p></div>";
  document.body.appendChild(o);
}

function goApp(){
  window.location.href="marketplace.html";
}

function watch(uid){
  onSnapshot(doc(db,"profiles",uid),(snap)=>{
    if(!snap.exists()) return;
    const d=snap.data();

    if(d.deletedAtMs){
      alert("Account removed.");
      return;
    }

    if(d.accessApproved){
      let o=document.getElementById("pendingOverlay");
      if(o) o.remove();
      goApp();
    }
  });
}

// SIGNUP (AUTO SAVE + STAY LOGGED IN)
window.handleSignup = async ()=>{
  const email=document.getElementById("signupEmail").value.trim();
  const pass=document.getElementById("signupPassword").value.trim();

  if(!email||!pass){
    alert("Complete all fields.");
    return;
  }

  try{
    const cred = await createUserWithEmailAndPassword(auth,email,pass);

    await setDoc(doc(db,"profiles",cred.user.uid),{
      email,
      accessApproved:false,
      deletedAtMs:null,
      createdAt:serverTimestamp()
    });

    showPending();
    watch(cred.user.uid);

  }catch(e){
    alert(e.message);
  }
};

// LOGIN
window.handleLogin = async ()=>{
  const email=document.getElementById("loginEmail").value.trim();
  const pass=document.getElementById("loginPassword").value.trim();

  try{
    const cred = await signInWithEmailAndPassword(auth,email,pass);
    const snap = await getDoc(doc(db,"profiles",cred.user.uid));

    if(!snap.exists()){
      alert("No account found.");
      return;
    }

    const d=snap.data();

    if(d.deletedAtMs){
      alert("Account removed.");
      return;
    }

    if(!d.accessApproved){
      showPending();
      watch(cred.user.uid);
      return;
    }

    goApp();

  }catch(e){
    if(e.code==="auth/invalid-credential"){
      alert("Incorrect email or password.");
      return;
    }
    alert(e.message);
  }
};

onAuthStateChanged(auth,(user)=>{
  if(user){
    watch(user.uid);
  }
});
