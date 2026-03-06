import { auth, db, onAuthStateChanged, signOut } from './firebase-config.js';
import { collection, getDocs, doc, deleteDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js';


document.addEventListener('DOMContentLoaded', () => {

    const adminView = document.getElementById('admin-view');
    const adminLoginView = document.getElementById('admin-login-view');
    const postListAdmin = document.getElementById('post-list-admin');
    const logoutBtn = document.getElementById('logout-btn');

    const ADMIN_UIDS = ["YOUR_ADMIN_UID_HERE", "ANOTHER_ADMIN_UID_HERE"]; // IMPORTANT: Must match main.js & firestore.rules

    onAuthStateChanged(auth, user => {
        if (user && ADMIN_UIDS.includes(user.uid)) {
            // User is an admin
            adminLoginView.style.display = 'none';
            adminView.style.display = 'block';
            loadPosts();
        } else {
            // User is not an admin or not logged in
            adminLoginView.style.display = 'flex';
            adminView.style.display = 'none';
        }
    });

    const loadPosts = async () => {
        postListAdmin.innerHTML = '<li>Loading posts...</li>';
        const postsCol = collection(db, 'posts');
        const q = query(postsCol, orderBy('createdAt', 'desc'));
        const postSnapshot = await getDocs(q);
        const posts = postSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        renderAdminPosts(posts);
    };

    const renderAdminPosts = (posts) => {
        postListAdmin.innerHTML = '';
        if (posts.length === 0) {
            postListAdmin.innerHTML = '<li>No posts to display.</li>';
            return;
        }

        posts.forEach(post => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>
                    <strong>${post.title}</strong> by ${post.authorName} 
                    <small>(${new Date(post.createdAt.seconds * 1000).toLocaleDateString()})</small>
                </span>
                <button class="btn danger small-btn" data-id="${post.id}">Delete</button>
            `;
            postListAdmin.appendChild(li);
        });
    };
    
    postListAdmin.addEventListener('click', async (e) => {
        if(e.target.tagName === 'BUTTON' && e.target.dataset.id) {
            const postId = e.target.dataset.id;
            if(confirm(`Are you sure you want to permanently delete post ${postId}?`)){
                 try {
                    await deleteDoc(doc(db, "posts", postId));
                    alert("Post deleted.");
                    loadPosts(); // Refresh the list
                } catch (error) {
                    console.error("Error deleting post from admin panel: ", error);
                    alert(`Error: ${error.message}`);
                }
            }
        }
    });

    logoutBtn.addEventListener('click', () => {
        signOut(auth).catch(err => alert(`Logout Failed: ${err.message}`));
    });

});