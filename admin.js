import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const userList = document.getElementById('user-list');
const itemList = document.getElementById('item-list');
const menuItems = document.querySelectorAll('.sidebar li');

// --- Navigation ---
menuItems.forEach(item => {
    item.addEventListener('click', () => {
        // Hide all sections
        document.querySelectorAll('.admin-section').forEach(section => {
            section.style.display = 'none';
        });

        // Show the target section
        const targetId = item.dataset.target;
        document.getElementById(targetId).style.display = 'block';

        // Set active class
        menuItems.forEach(menuItem => menuItem.classList.remove('active'));
        item.classList.add('active');
    });
});

// --- Data Fetching ---
async function fetchUsers() {
    // This is a placeholder as Firebase Admin SDK is needed to list all users.
    // In a real app, you would use a backend function.
    userList.innerHTML = '<p>User listing requires a backend function.</p>';
}

async function fetchItems() {
    const itemsCollection = collection(db, 'items');
    const itemSnapshot = await getDocs(itemsCollection);
    const items = itemSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    displayItems(items);
}

function displayItems(items) {
    itemList.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Price</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => `
                    <tr>
                        <td>${item.id}</td>
                        <td>${item.title}</td>
                        <td>$${item.price}</td>
                        <td><button>Delete</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Initial fetch
fetchUsers();
fetchItems();
