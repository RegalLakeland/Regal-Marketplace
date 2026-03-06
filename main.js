import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const loginButton = document.getElementById('login-button');
const loginModal = document.getElementById('login-modal');
const closeButton = document.querySelector('.close-button');
const loginForm = document.getElementById('login-form');
const signupLink = document.getElementById('signup-link');
const userStatus = document.getElementById('user-status');
const itemGrid = document.getElementById('item-grid');
const itemCount = document.getElementById('item-count');
const totalCount = document.getElementById('total-count');


// --- Authentication ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        userStatus.textContent = `Signed in as ${user.email}`;
        loginButton.textContent = 'Logout';
        loginModal.style.display = 'none';
    } else {
        userStatus.textContent = 'Not signed in';
        loginButton.textContent = 'Login';
    }
});

loginButton.addEventListener('click', () => {
    if (auth.currentUser) {
        auth.signOut();
    } else {
        loginModal.style.display = 'block';
    }
});

closeButton.addEventListener('click', () => {
    loginModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target == loginModal) {
        loginModal.style.display = 'none';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        if (loginForm.dataset.mode === 'signup') {
            await createUserWithEmailAndPassword(auth, email, password);
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (error) {
        console.error('Authentication error:', error);
        alert(error.message);
    }
});

signupLink.addEventListener('click', (e) => {
    e.preventDefault();
    const loginHeader = loginModal.querySelector('h2');
    const submitButton = loginForm.querySelector('button');

    if (loginForm.dataset.mode === 'signup') {
        loginHeader.textContent = 'Login';
        submitButton.textContent = 'Login';
        signupLink.textContent = 'Sign up';
        loginForm.dataset.mode = 'login';
    } else {
        loginHeader.textContent = 'Sign Up';
        submitButton.textContent = 'Sign Up';
        signupLink.innerHTML = 'Already have an account? <a href="#">Login</a>';
        loginForm.dataset.mode = 'signup';
    }
});

// --- Marketplace ---

async function fetchItems() {
    const itemsCollection = collection(db, 'items');
    const itemSnapshot = await getDocs(itemsCollection);
    const items = itemSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    displayItems(items);
}

function displayItems(items) {
    itemGrid.innerHTML = '';
    itemCount.textContent = items.length;
    totalCount.textContent = items.length; // This should be the total count from the database

    items.forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'item-card';

        itemCard.innerHTML = `
            <img src="${item.imageUrl || 'https://via.placeholder.com/250'}" alt="${item.title}">
            <div class="item-card-content">
                <h3>${item.title}</h3>
                <p class="price">$${item.price}</p>
                <p>${item.description}</p>
            </div>
        `;
        itemGrid.appendChild(itemCard);
    });
}

// Initial fetch
fetchItems();
