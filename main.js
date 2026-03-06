import {
    app, auth, db, storage,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile,
    collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy, Timestamp,
    ref, uploadBytes, getDownloadURL, deleteObject
} from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const authView = document.getElementById('auth-view');
    const mainView = document.getElementById('main-view');
    const contentArea = document.getElementById('content-area');
    const categoryList = document.getElementById('category-list');
    const viewToggle = document.getElementById('view-toggle-switch');
    const userDisplay = document.getElementById('user-display');
    const postModalContainer = document.getElementById('post-modal');
    const detailModalContainer = document.getElementById('detail-modal');
    const adminDashboardBtn = document.getElementById('admin-dashboard-btn');

    let currentUser = null;
    let currentUserIsAdmin = false;
    let currentCategory = 'all';
    let isListView = false;

    // --- Helper function to check admin status ---
    const checkAdminStatus = async (user) => {
        if (!user) return false;
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        return userDocSnap.exists() && userDocSnap.data().isAdmin === true;
    };

    // --- Authentication State --- 
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            currentUserIsAdmin = await checkAdminStatus(user);

            userDisplay.textContent = `Welcome, ${user.displayName || user.email}`;
            authView.style.display = 'none';
            mainView.style.display = 'block';

            if (currentUserIsAdmin) {
                adminDashboardBtn.style.display = 'block';
            }

            await loadPosts();
        } else {
            currentUser = null;
            currentUserIsAdmin = false;
            authView.style.display = 'flex';
            mainView.style.display = 'none';
            adminDashboardBtn.style.display = 'none';
        }
    });

    // --- Authentication Actions ---
    const signupForm = document.getElementById('signup-form');
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });

            // Create a user profile document in Firestore
            const userDocRef = doc(db, 'users', userCredential.user.uid);
            await setDoc(userDocRef, {
                uid: userCredential.user.uid,
                displayName: name,
                email: email,
                createdAt: Timestamp.now(),
                isAdmin: false // All new users are not admins by default
            });

        } catch (error) {
            alert(error.message);
        }
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            alert(error.message);
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

    // --- Post Loading & Rendering (No changes in this section) ---
    const loadPosts = async () => { /* ... existing code ... */ };
    const renderPost = (id, data) => { /* ... existing code ... */ };

    // --- Event Listeners (No changes in this section) ---
    categoryList.addEventListener('click', (e) => { /* ... existing code ... */ });
    viewToggle.addEventListener('change', () => { /* ... existing code ... */ });
    document.getElementById('create-post-btn').addEventListener('click', () => openPostModal());
    adminDashboardBtn.addEventListener('click', openAdminDashboard);

    // --- Post Creation/Edit Modal (No changes in this section) ---
    const openPostModal = async (postId = null) => { /* ... existing code ... */ };

    // --- Post Detail Modal (No changes in this section) ---
    const openDetailModal = async (postId) => { /* ... existing code ... */ };


    // --- ADMIN DASHBOARD (MAJOR UPDATE) ---
    const openAdminDashboard = async () => {
        detailModalContainer.style.display = 'flex';
        detailModalContainer.innerHTML = `
            <div class="modal-container wide">
                <div class="modal-header">
                    <h2>Admin Dashboard</h2>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body" id="admin-dashboard-body">
                    <!-- Admin tabs will be injected here -->
                </div>
            </div>
        `;

        document.querySelector('#detail-modal .close-btn').addEventListener('click', () => {
            detailModalContainer.style.display = 'none';
            loadPosts();
        });
        
        renderAdminTabs();
        loadUserManagement(); // Load the user management tab by default
    };

    const renderAdminTabs = () => {
        const body = document.getElementById('admin-dashboard-body');
        body.innerHTML = `
            <div class="auth-tabs">
                <button class="tab-btn admin-tab active" data-tab="users">User Management</button>
                <button class="tab-btn admin-tab" data-tab="posts">Post Management</button>
            </div>
            <div id="admin-tab-content"></div>
        `;
        body.querySelector('.auth-tabs').addEventListener('click', (e) => {
            if(e.target.classList.contains('admin-tab')){
                body.querySelector('.tab-btn.active').classList.remove('active');
                e.target.classList.add('active');
                const tab = e.target.dataset.tab;
                if(tab === 'users') loadUserManagement();
                if(tab === 'posts') loadPostManagement();
            }
        });
    };

    const loadUserManagement = async () => {
        const content = document.getElementById('admin-tab-content');
        content.innerHTML = `<div class="user-list">Loading users...</div>`;
        
        const usersQuery = query(collection(db, "users"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(usersQuery);

        const userListHTML = querySnapshot.docs.map(doc => {
            const user = doc.data();
            // Prevent the current admin from accidentally removing their own status
            const isCurrentUser = user.uid === currentUser.uid;
            return `
                <div class="user-list-item">
                    <div>
                        <p class="user-name">${user.displayName}</p>
                        <p class="user-email">${user.email}</p>
                    </div>
                    <div class="admin-toggle">
                        <span>Admin</span>
                        <label class="switch">
                            <input type="checkbox" class="admin-status-toggle" data-uid="${user.uid}" ${user.isAdmin ? 'checked' : ''} ${isCurrentUser ? 'disabled' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
            `;
        }).join('');

        content.innerHTML = `<div class="user-list">${userListHTML}</div>`;

        // Add event listeners to the new toggles
        content.querySelectorAll('.admin-status-toggle').forEach(toggle => {
            toggle.addEventListener('change', async (e) => {
                const userIdToUpdate = e.target.dataset.uid;
                const newAdminStatus = e.target.checked;
                if(confirm(`Are you sure you want to ${newAdminStatus ? 'grant' : 'revoke'} admin privileges for this user?`)){
                    const userDocRef = doc(db, 'users', userIdToUpdate);
                    try {
                        await updateDoc(userDocRef, { isAdmin: newAdminStatus });
                        alert('User status updated successfully!');
                    } catch (error) {
                        console.error("Error updating user status:", error);
                        alert('Failed to update user status.');
                        e.target.checked = !newAdminStatus; // Revert toggle on failure
                    }
                }
            });
        });
    };

    const loadPostManagement = async () => { /* ... existing code to load active/deleted posts ... */ };
    const renderAdminPost = (id, data, container) => { /* ... existing code ... */ };

});
