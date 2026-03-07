import {
    app, auth, db, storage,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile,
    collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy, Timestamp, setDoc,
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

    const checkAdminStatus = async (user) => {
        if (!user) return false;
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists() && userDocSnap.data().isAdmin === true) {
            return true;
        } else {
            // This is the first admin setup logic.
            if (user.uid === '04kJ20DobhVsTNnty8XX0MSrTXI3') {
                 await setDoc(userDocRef, { isAdmin: true }, { merge: true });
                 return true;
            }
            return false;
        }
    };

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

    const signupForm = document.getElementById('signup-form');
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: name });
            const userDocRef = doc(db, 'users', userCredential.user.uid);
            await setDoc(userDocRef, {
                uid: userCredential.user.uid,
                displayName: name,
                email: email,
                createdAt: Timestamp.now(),
                isAdmin: false
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

    const loadPosts = async () => {
        contentArea.innerHTML = '';
        let postsQuery = query(collection(db, "posts"), where("isDeleted", "==", false), orderBy("createdAt", "desc"));
        if (currentCategory !== 'all') {
            postsQuery = query(collection(db, "posts"), where("category", "==", currentCategory), where("isDeleted", "==", false), orderBy("createdAt", "desc"));
        }
        const querySnapshot = await getDocs(postsQuery);
        querySnapshot.forEach(doc => {
            renderPost(doc.id, doc.data());
        });
    };

    const renderPost = (id, data) => {
        const postElement = document.createElement('div');
        postElement.className = isListView ? 'forum-item' : 'post-card';
        postElement.dataset.id = id;
        const imageUrl = data.imageUrls && data.imageUrls[0] ? data.imageUrls[0] : 'https://via.placeholder.com/300';
        if (!isListView) {
            postElement.innerHTML = `
                <img src="${imageUrl}" alt="${data.title}" class="post-image">
                <div class="post-content">
                    <h4>${data.title}</h4>
                    <p class="price">${data.price ? `$${data.price}` : ''}</p>
                </div>
            `;
        } else {
            postElement.innerHTML = `
                <div class="post-content">
                    <h4>${data.title}</h4>
                    <p>By ${data.authorName} - ${data.createdAt.toDate().toLocaleDateString()}</p>
                </div>
                <p class="price">${data.price ? `$${data.price}` : 'Discussion'}</p>
            `;
        }
        postElement.addEventListener('click', () => openDetailModal(id));
        contentArea.appendChild(postElement);
    };

    categoryList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
            document.querySelector('#category-list .active').classList.remove('active');
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            document.getElementById('content-title').textContent = e.target.textContent;
            loadPosts();
        }
    });

    viewToggle.addEventListener('change', () => {
        isListView = viewToggle.checked;
        contentArea.className = isListView ? 'forum-list' : 'marketplace-grid';
        loadPosts(); 
    });

    document.getElementById('create-post-btn').addEventListener('click', () => openPostModal());
    adminDashboardBtn.addEventListener('click', openAdminDashboard);

    const openPostModal = async (postId = null) => {
        let post = {};
        if (postId) {
            const docRef = doc(db, 'posts', postId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                post = docSnap.data();
            }
        }
        postModalContainer.style.display = 'flex';
        postModalContainer.innerHTML = `
            <div class="modal-container wide">
                <div class="modal-header">
                    <h2>${postId ? 'Edit' : 'Create'} Post</h2>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="post-form">
                         <input type="text" id="post-title" placeholder="Title" value="${post.title || ''}" required>
                         <textarea id="post-description" placeholder="Description">${post.description || ''}</textarea>
                         <div class="form-grid">
                             <select id="post-category" required>
                                 <option value="for-sale" ${post.category === 'for-sale' ? 'selected' : ''}>For Sale</option>
                                 <option value="discussion" ${post.category === 'discussion' ? 'selected' : ''}>Discussion</option>
                                 <option value="services" ${post.category === 'services' ? 'selected' : ''}>Services</option>
                             </select>
                             <input type="number" id="post-price" placeholder="Price (optional)" value="${post.price || ''}">
                         </div>
                         <label>Images</label>
                         <input type="file" id="post-images" multiple accept="image/*">
                         <div id="image-previews"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button id="save-post-btn" class="btn primary">${postId ? 'Save Changes' : 'Publish Post'}</button>
                </div>
            </div>
        `;
        document.querySelector('#post-modal .close-btn').addEventListener('click', () => postModalContainer.style.display = 'none');
        document.getElementById('save-post-btn').addEventListener('click', async () => {
            const title = document.getElementById('post-title').value;
            const description = document.getElementById('post-description').value;
            const category = document.getElementById('post-category').value;
            const price = document.getElementById('post-price').value;
            const imageFiles = document.getElementById('post-images').files;
            if (!title) return alert('Title is required.');
            try {
                const imageUrls = post.imageUrls || [];
                for (const file of imageFiles) {
                    const imageRef = ref(storage, `posts/${Date.now()}_${file.name}`);
                    await uploadBytes(imageRef, file);
                    const url = await getDownloadURL(imageRef);
                    imageUrls.push(url);
                }
                const postData = {
                    title, description, category,
                    price: price ? Number(price) : null,
                    imageUrls, authorId: currentUser.uid, authorName: currentUser.displayName, isDeleted: false
                };
                if (postId) {
                    const postRef = doc(db, 'posts', postId);
                    await updateDoc(postRef, postData);
                } else {
                    postData.createdAt = Timestamp.now();
                    await addDoc(collection(db, 'posts'), postData);
                }
                postModalContainer.style.display = 'none';
                loadPosts();
            } catch (error) {
                console.error("Error saving post: ", error);
                alert("Failed to save post.");
            }
        });
    };

    const openDetailModal = async (postId) => {
        const docRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;
        const post = docSnap.data();
        detailModalContainer.style.display = 'flex';
        detailModalContainer.innerHTML = `
            <div class="modal-container wide">
                <div class="modal-header">
                    <h2>${post.title}</h2>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="detail-images">
                        ${post.imageUrls && post.imageUrls.map(url => `<img src="${url}" alt="Post image">`).join('')}
                    </div>
                    <p><strong>Price:</strong> ${post.price ? `$${post.price}` : 'N/A'}</p>
                    <p><strong>Posted by:</strong> ${post.authorName}</p>
                    <p>${post.description}</p>
                </div>
                <div class="modal-footer" id="detail-footer"></div>
            </div>
        `;
        document.querySelector('#detail-modal .close-btn').addEventListener('click', () => detailModalContainer.style.display = 'none');
        const footer = document.getElementById('detail-footer');
        if (currentUser && currentUser.uid === post.authorId) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.className = 'btn primary';
            editBtn.onclick = () => {
                detailModalContainer.style.display = 'none';
                openPostModal(postId);
            };
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'btn danger';
            deleteBtn.onclick = async () => {
                if (confirm('Are you sure you want to delete this post?')) {
                    const postRef = doc(db, 'posts', postId);
                    await updateDoc(postRef, { isDeleted: true });
                    detailModalContainer.style.display = 'none';
                    loadPosts();
                }
            };
            footer.append(editBtn, deleteBtn);
        }
    };

    const openAdminDashboard = async () => {
        detailModalContainer.style.display = 'flex';
        detailModalContainer.innerHTML = `
            <div class="modal-container wide">
                <div class="modal-header">
                    <h2>Admin Dashboard</h2>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body" id="admin-dashboard-body">
                </div>
            </div>
        `;
        document.querySelector('#detail-modal .close-btn').addEventListener('click', () => {
            detailModalContainer.style.display = 'none';
            loadPosts();
        });
        renderAdminTabs();
        loadUserManagement();
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
            if (e.target.classList.contains('admin-tab')) {
                body.querySelector('.tab-btn.active').classList.remove('active');
                e.target.classList.add('active');
                const tab = e.target.dataset.tab;
                if (tab === 'users') loadUserManagement();
                if (tab === 'posts') loadPostManagement();
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
        content.querySelectorAll('.admin-status-toggle').forEach(toggle => {
            toggle.addEventListener('change', async (e) => {
                const userIdToUpdate = e.target.dataset.uid;
                const newAdminStatus = e.target.checked;
                if (confirm(`Are you sure you want to ${newAdminStatus ? 'grant' : 'revoke'} admin privileges for this user?`)) {
                    const userDocRef = doc(db, 'users', userIdToUpdate);
                    try {
                        await updateDoc(userDocRef, { isAdmin: newAdminStatus });
                        alert('User status updated successfully!');
                    } catch (error) {
                        console.error("Error updating user status:", error);
                        alert('Failed to update user status.');
                        e.target.checked = !newAdminStatus;
                    }
                }
            });
        });
    };

    const loadPostManagement = async () => {
        const content = document.getElementById('admin-tab-content');
        content.innerHTML = `
            <div class="admin-section">
                <h3>Active Posts</h3>
                <div id="admin-active-posts" class="admin-post-grid">Loading...</div>
            </div>
            <div class="admin-section">
                <h3>Deleted Posts</h3>
                <div id="admin-deleted-posts" class="admin-post-grid">Loading...</div>
            </div>
        `;
        const activePostsContainer = document.getElementById('admin-active-posts');
        activePostsContainer.innerHTML = '';
        const activeQuery = query(collection(db, "posts"), where("isDeleted", "==", false));
        const activeSnapshot = await getDocs(activeQuery);
        activeSnapshot.forEach(doc => renderAdminPost(doc.id, doc.data(), activePostsContainer));
        const deletedPostsContainer = document.getElementById('admin-deleted-posts');
        deletedPostsContainer.innerHTML = '';
        const deletedQuery = query(collection(db, "posts"), where("isDeleted", "==", true));
        const deletedSnapshot = await getDocs(deletedQuery);
        deletedSnapshot.forEach(doc => renderAdminPost(doc.id, doc.data(), deletedPostsContainer));
    };

    const renderAdminPost = (id, data, container) => {
        const postElement = document.createElement('div');
        postElement.className = 'post-card';
        const imageUrl = data.imageUrls && data.imageUrls[0] ? data.imageUrls[0] : 'https://via.placeholder.com/300';
        postElement.innerHTML = `
            <img src="${imageUrl}" alt="${data.title}" class="post-image">
            <div class="post-content">
                <h4>${data.title}</h4>
                <p>By ${data.authorName}</p>
            </div>
            <div class="post-actions">
                ${data.isDeleted ? 
                    `<button class="btn restore" data-id="${id}">Restore</button>` : ''
                }
                <button class="btn perm-delete" data-id="${id}">Delete Permanently</button>
            </div>
        `;
        container.appendChild(postElement);
    };

    detailModalContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const postId = target.dataset.id;
        if (target.classList.contains('restore')) {
            if (confirm('Are you sure you want to restore this post?')) {
                const postRef = doc(db, 'posts', postId);
                await updateDoc(postRef, { isDeleted: false });
                loadPostManagement();
            }
        }
        if (target.classList.contains('perm-delete')) {
            if (confirm('This is permanent and cannot be undone. Are you sure?')) {
                const postRef = doc(db, 'posts', postId);
                await deleteDoc(postRef);
                loadPostManagement();
            }
        }
    });
});
