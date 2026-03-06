import { db } from './firebase-config.js';
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    loadAdminDashboard();
});

async function loadAdminDashboard() {
    loadUsers();
    loadAllPosts();
}

async function loadUsers() {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    // Note: Listing users requires Firebase Admin SDK on a server.
    // This is a simplified example, you can't list users directly from the client.
    // We will simulate this by showing users who have posted.
    const postsSnapshot = await getDocs(collection(db, "posts"));
    const users = new Map();
    postsSnapshot.forEach(doc => {
        const post = doc.data();
        if (!users.has(post.authorId)) {
            users.set(post.authorId, post.authorName);
        }
    });

    users.forEach((name, id) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${name} (${id})</span> <button class="danger-btn" data-uid="${id}">Ban User</button>`;
        userList.appendChild(li);
    });

    userList.addEventListener('click', e => {
        if (e.target.classList.contains('danger-btn')) {
            const uid = e.target.dataset.uid;
            // You would need a backend function to actually ban a user.
            alert(`Banning user ${uid} would be implemented on a backend.`);
        }
    });
}

async function loadAllPosts() {
    const postList = document.getElementById('post-list-admin');
    postList.innerHTML = '';
    const querySnapshot = await getDocs(collection(db, "posts"));
    querySnapshot.forEach((doc) => {
        const post = doc.data();
        const li = document.createElement('li');
        li.innerHTML = `<span>${post.title} by ${post.authorName}</span> <button class="danger-btn" data-postid="${doc.id}">Delete</button>`;
        postList.appendChild(li);
    });

    postList.addEventListener('click', async e => {
        if (e.target.classList.contains('danger-btn')) {
            const postId = e.target.dataset.postid;
            if (confirm('Are you sure you want to permanently delete this post?')) {
                await deleteDoc(doc(db, 'posts', postId));
                loadAllPosts();
            }
        }
    });
}

document.getElementById('back-to-main-view-btn').addEventListener('click', () => {
    // A bit of a hack to get back to the main app view
    window.location.href = 'index.html'; 
});
