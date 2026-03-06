
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB6IAiH6zILQKuJRuXc55Q4hEX8q6F2kxE",
  authDomain: "regal-lakeland-marketplace.firebaseapp.com",
  projectId: "regal-lakeland-marketplace",
  storageBucket: "regal-lakeland-marketplace.firebasestorage.app",
  messagingSenderId: "1014346693296",
  appId: "1:1014346693296:web:fc76118d1a8db347945975"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Export the initialized services
export { app, auth, db, storage };
