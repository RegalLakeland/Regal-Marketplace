
const firebaseConfig = {
  apiKey: "AIzaSyB6IAiH6zILQKuJRuXc55Q4hEX8q6F2kxE",
  authDomain: "regal-lakeland-marketplace.firebaseapp.com",
  projectId: "regal-lakeland-marketplace",
  storageBucket: "regal-lakeland-marketplace.firebasestorage.app",
  messagingSenderId: "1014346693296",
  appId: "1:1014346693296:web:fc76118d1a8db347945975"
};


firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
