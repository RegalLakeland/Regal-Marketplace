// === FINAL STABLE VERSION (DO NOT EDIT CONFIG) ===

// SAFE FIXES
window.clearTempLoginContext = function(){};

// FORCE SCROLL FIX
window.addEventListener("load", ()=>{
  document.body.style.overflow='';
  document.documentElement.style.overflow='';
});

// TERMS CHECK
async function enforceTerms(user, profile, db, updateDoc, doc){
  if(!profile.termsAccepted){
    const agree = confirm("You must agree to company rules to continue.");
    if(!agree){
      alert("You must accept rules.");
      return false;
    }
    await updateDoc(doc(db,'profiles',user.uid),{
      termsAccepted:true,
      termsAcceptedAt:Date.now()
    });
  }
  return true;
}

// PATCH SIGNUP (NO AUTO LOGIN FREEZE)
async function handleSignup(){
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const password = document.getElementById('signupPassword').value;
  const name = document.getElementById('signupFullName').value;

  if(!email || !password || !name){
    alert("Fill all fields");
    return;
  }

  try{
    const cred = await createUserWithEmailAndPassword(auth,email,password);

    await setDoc(doc(db,'profiles',cred.user.uid),{
      email,
      displayName:name,
      accessApproved:false,
      termsAccepted:false,
      createdAt:Date.now()
    });

    // CRITICAL FIX: SIGN OUT AFTER SIGNUP
    await signOut(auth);

    alert("Account created. Waiting for admin approval.");
    document.getElementById('tabLogin').click();

  }catch(e){
    alert(e.message);
  }
}

// PATCH LOGIN
async function handleLogin(){
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  try{
    const cred = await signInWithEmailAndPassword(auth,email,password);
    const user = cred.user;

    const snap = await getDoc(doc(db,'profiles',user.uid));
    const profile = snap.data();

    if(!profile.accessApproved){
      alert("Waiting for admin approval");
      return;
    }

    const ok = await enforceTerms(user, profile, db, updateDoc, doc);
    if(!ok) return;

    location.reload();

  }catch(e){
    alert("Wrong email or password");
  }
}
