
// CLEAN FINAL APP.JS (STABLE BUILD)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

// ---------- TOAST ----------
function showToast(msg){
  const t=document.createElement('div');
  t.style.position='fixed';
  t.style.bottom='20px';
  t.style.left='50%';
  t.style.transform='translateX(-50%)';
  t.style.background='#111';
  t.style.color='#fff';
  t.style.padding='12px 18px';
  t.style.borderRadius='10px';
  t.style.zIndex=9999;
  t.innerText=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// ---------- PENDING SCREEN ----------
function showPendingScreen(){
  if(document.getElementById('pendingOverlay')) return;

  const overlay=document.createElement('div');
  overlay.id='pendingOverlay';
  overlay.style.position='fixed';
  overlay.style.top=0;
  overlay.style.left=0;
  overlay.style.width='100%';
  overlay.style.height='100%';
  overlay.style.background='rgba(0,0,0,0.9)';
  overlay.style.display='flex';
  overlay.style.alignItems='center';
  overlay.style.justifyContent='center';
  overlay.style.zIndex=9999;

  overlay.innerHTML=`
    <div style="text-align:center;color:white;">
      <h2>Account Created</h2>
      <p>Waiting for admin approval...</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ---------- AUTO APPROVAL ----------
function startApprovalWatcher(uid){
  onSnapshot(doc(db,'profiles',uid),(snap)=>{
    if(!snap.exists()) return;
    const d=snap.data();

    if(d.accessApproved === true && !d.deletedAtMs){
      const overlay=document.getElementById('pendingOverlay');
      if(overlay) overlay.remove();

      showToast("Account approved. Welcome!");
    }
  });
}

// ---------- CREATE ACCOUNT ----------
window.handleSignup = async function(){
  const name=document.getElementById('signupName').value.trim();
  const email=document.getElementById('signupEmail').value.trim();
  const pass=document.getElementById('signupPassword').value.trim();
  const confirm=document.getElementById('signupConfirm').value.trim();

  if(!name || !email || !pass || !confirm){
    alert("Complete all signup fields.");
    return;
  }

  if(pass !== confirm){
    alert("Passwords do not match.");
    return;
  }

  try{
    const cred = await createUserWithEmailAndPassword(auth,email,pass);

    await setDoc(doc(db,'profiles',cred.user.uid),{
      uid: cred.user.uid,
      email,
      displayName: name,
      accessApproved:false,
      banned:false,
      deletedAtMs:null,
      createdAt: serverTimestamp()
    });

    currentUser = cred.user;

    showPendingScreen();
    startApprovalWatcher(cred.user.uid);

  }catch(err){
    console.error(err);
    alert(err.message || "Signup failed");
  }
}

// ---------- LOGIN ----------
window.handleLogin = async function(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPassword').value.trim();

  try{
    const cred = await signInWithEmailAndPassword(auth,email,pass);
    const snap = await getDoc(doc(db,'profiles',cred.user.uid));

    if(!snap.exists()){
      alert("Account not found.");
      return;
    }

    const d = snap.data();

    if(d.deletedAtMs){
      alert("Account removed. Contact admin.");
      return;
    }

    if(!d.accessApproved){
      showPendingScreen();
      startApprovalWatcher(cred.user.uid);
      return;
    }

    showToast("Welcome back!");

  }catch(err){
    if(err.code === "auth/invalid-credential"){
      alert("Incorrect email or password.");
      return;
    }
    alert(err.message);
  }
}

// ---------- AUTH STATE ----------
onAuthStateChanged(auth,(user)=>{
  if(user){
    currentUser = user;
    startApprovalWatcher(user.uid);
  }
});
