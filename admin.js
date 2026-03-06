
import { db } from './firebase-config.js';
import { getDocs, collection, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

const userList = document.getElementById('user-list');
const postListAdmin = document.getElementById('post-list-admin');
const adminView = document.getElementById('admin-view');
const mainView = document.getElementById('main-view');

// Basic profanity filter (expand with a more robust list)
const profanity = ['badword1', 'badword2', 'badword3']; 

export async function loadAdminDashboard() {
    if (adminView.style.display !== 'block') return;

    // Load Users
    userList.innerHTML = '';
    const usersSnapshot = await getDocs(collection(db, 'users')); // Assuming you create a 'users' collection
    usersSnapshot.forEach(userDoc => {
        const userData = userDoc.data();
        const li = document.createElement('li');
        li.textContent = `${userData.username} (${userData.email})`;
        const banBtn = document.createElement('button');
        banBtn.textContent = userData.isBanned ? 'Unban' : 'Ban';
        banBtn.onclick = () => toggleBanStatus(userDoc.id, userData.isBanned);
        li.appendChild(banBtn);
        userList.appendChild(li);
    });

    // Load Posts
    postListAdmin.innerHTML = '';
    const postsSnapshot = await getDocs(collection(db, 'posts'));
    postsSnapshot.forEach(postDoc => {
        const postData = postDoc.data();
        const li = document.createElement('li');
        
        let content = `${postData.title}`;
        // Profanity check
        const foundProfanity = profanity.find(word => postData.description.includes(word) || postData.title.includes(word));
        if(foundProfanity) {
            content += ` <span style="color: red;">[PROFANITY: ${foundProfanity}]</span>`;
        }

        li.innerHTML = content;
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'danger-btn';
        deleteBtn.onclick = () => deletePostAdmin(postDoc.id);
        li.appendChild(deleteBtn);
        postListAdmin.appendChild(li);
    });
}

async function toggleBanStatus(userId, isBanned) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { isBanned: !isBanned });
    loadAdminDashboard(); // Refresh
}

async function deletePostAdmin(postId) {
    if (confirm('Are you sure you want to permanently delete this post?')) {
        await deleteDoc(doc(db, 'posts', postId));
        loadAdminDashboard(); // Refresh
    }
}

document.getElementById('admin-back-btn').addEventListener('click', () => {
    adminView.style.display = 'none';
    mainView.style.display = 'block';
});

// Initial call if admin view is shown
document.getElementById('admin-dashboard-btn').addEventListener('click', loadAdminDashboard);
