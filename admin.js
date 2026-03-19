// FINAL ADMIN.JS

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function render(users){
  const container=document.getElementById("users");
  container.innerHTML="";

  users.forEach(u=>{
    if(u.deletedAtMs) return;

    const row=document.createElement("div");
    row.innerHTML=`
      <strong>${u.email}</strong>
      <button onclick="approve('${u.id}')">Approve</button>
      <button onclick="deleteUser('${u.id}')">Delete</button>
    `;
    container.appendChild(row);
  });
}

window.approve = async (id)=>{
  await updateDoc(doc(db,"profiles",id),{
    accessApproved:true
  });
};

window.deleteUser = async (id)=>{
  await updateDoc(doc(db,"profiles",id),{
    deletedAtMs:Date.now()
  });
};

onSnapshot(collection(db,"profiles"),(snap)=>{
  const users=snap.docs.map(d=>({id:d.id,...d.data()}));
  render(users);
});
