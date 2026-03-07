import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    getDoc,
    setDoc,
    query,
    where,
    orderBy,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const authView = document.getElementById('auth-view');
    const mainView = document.getElementById('main-view');
    const loginBackground = document.getElementById('login-background');
    const appBackground = document.querySelector('.slideshow');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const userDisplay = document.getElementById('user-display');
    const logoutBtn = document.getElementById('logout-btn');
    const adminDashboardBtn = document.getElementById('admin-dashboard-btn');
    const createPostBtn = document.getElementById('create-post-btn');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const authForms = document.querySelectorAll('.auth-form');
    const categoryList = document.getElementById('category-list');
    const contentArea = document.getElementById('content-area');
    const contentTitle = document.getElementById('content-title');
    const viewToggle = document.getElementById('view-toggle-switch');
    const postModalContainer = document.getElementById('post-modal');
    const detailModalContainer = document.getElementById('detail-modal');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    let currentUser = null;
    let currentUserIsAdmin = false;

    // --- Helper Functions ---
    const checkAdminStatus = async (user) => {
        if (!user) return false;
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
            return userDoc.data().isAdmin || false;
        } 
        return false;
    };

    // --- Main App Logic ---
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            let displayName = 'User';
            currentUserIsAdmin = userDoc.exists() ? userDoc.data().isAdmin || false : false;

            if (userDoc.exists()) {
                displayName = userDoc.data().name || 'User';
            }

            userDisplay.textContent = `Welcome, ${displayName}`;
            adminDashboardBtn.style.display = currentUserIsAdmin ? 'block' : 'none';

            authView.style.display = 'none';
            mainView.style.display = 'block';
            loginBackground.style.display = 'none';
            appBackground.style.display = 'block';
            
            fetchPosts(); // Initial fetch
        } else {
            currentUserIsAdmin = false;
            authView.style.display = 'flex';
            mainView.style.display = 'none';
            loginBackground.style.display = 'block';
            appBackground.style.display = 'none';
        }
    });
    
    // --- MODAL AND POST FUNCTIONS ---
    const openAdminDashboard = async () => { 
        // Implementation will go here in next steps 
        alert("Admin Dashboard coming soon!");
    }; 

    // --- EVENT LISTENERS (Setup after functions are defined) ---

    // Auth Tabs
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            authForms.forEach(form => form.classList.remove('active'));
            button.classList.add('active');
            document.getElementById(button.dataset.tab).classList.add('active');
        });
    });

    // Signup
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        if (!email.endsWith('@regallakeland.com')) {
            alert("You must use a @regallakeland.com email address to sign up.");
            return;
        }
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", userCredential.user.uid), {
                name: name,
                email: email,
                isAdmin: false // New users are never admins by default
            });
        } catch (error) {
            alert(`Error signing up: ${error.message}`);
        }
    });

    // Login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        signInWithEmailAndPassword(auth, email, password).catch(error => {
            alert(`Error logging in: ${error.message}`);
        });
    });

    // Logout
    logoutBtn.addEventListener('click', () => {
        signOut(auth);
    });

    // Admin Dashboard
    adminDashboardBtn.addEventListener('click', openAdminDashboard);

    // Fetch Posts (placeholder)
    const fetchPosts = () => {
        console.log("Fetching posts...");
        const postsQuery = query(collection(db, "posts"), where("isDeleted", "==", false), orderBy("createdAt", "desc"));
    }
});