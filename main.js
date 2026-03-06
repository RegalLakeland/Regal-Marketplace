import {
    auth,
    db,
    storage,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updateProfile
} from './firebase-config.js';

import {
    collection,
    addDoc,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js';

import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-storage.js';


// --- DOM Elements ---
document.addEventListener('DOMContentLoaded', () => {
    const loginOverlay = document.getElementById('login-overlay');
    const mainView = document.getElementById('main-view');

    // Auth Forms & Tabs
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const authTabs = document.querySelector('.auth-tabs');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    // Top Bar
    const userDisplay = document.getElementById('user-display');
    const adminDashboardBtn = document.getElementById('admin-dashboard-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // Main Content
    const categoryList = document.getElementById('category-list');
    const createPostBtn = document.getElementById('create-post-btn');
    const viewToggle = document.getElementById('view-toggle');
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');

    // Post Modal
    const postModal = document.getElementById('post-modal');
    const postForm = document.getElementById('post-form');
    const modalTitle = document.getElementById('modal-title');
    const closePostModalBtn = postModal.querySelector('.close-btn');
    const savePostBtn = document.getElementById('save-post-btn');
    const imagePreviews = document.getElementById('image-previews');
    const postImagesInput = document.getElementById('post-images');

    // Detail View
    const detailViewModal = document.getElementById('detail-view-modal');
    const detailViewContent = document.getElementById('detail-view-content');
    const closeDetailBtn = detailViewModal.querySelector('.close-detail-btn');

    let currentUser = null;
    let currentCategory = 'all';
    let allPosts = []; // Cache for posts

    const ADMIN_UIDS = ["YOUR_ADMIN_UID_HERE", "ANOTHER_ADMIN_UID_HERE"]; // IMPORTANT: Replace with actual Admin UIDs

    // --- Authentication Logic ---

    onAuthStateChanged(auth, user => {
        if (user) {
            currentUser = user;
            if (!user.displayName) {
                // First-time login, prompt for display name
                const displayName = prompt("Please enter your display name (e.g., First Last):");
                if (displayName) {
                    updateProfile(user, { displayName }).then(() => {
                        setupUI(user);
                    });
                } else {
                    // If they cancel, log them out
                    signOut(auth);
                }
            } else {
                setupUI(user);
            }
        } else {
            currentUser = null;
            setupUI(null);
        }
    });

    const setupUI = (user) => {
        if (user) {
            loginOverlay.style.display = 'none';
            mainView.style.display = 'block';
            userDisplay.textContent = `Welcome, ${user.displayName}`;
            if (ADMIN_UIDS.includes(user.uid)) {
                adminDashboardBtn.style.display = 'block';
            }
            fetchPosts();
        } else {
            loginOverlay.style.display = 'flex';
            mainView.style.display = 'none';
        }
    };

    authTabs.addEventListener('click', e => {
        if (e.target.tagName === 'BUTTON') {
            document.querySelector('.tab-btn.active').classList.remove('active');
            document.querySelector('.auth-form.active').classList.remove('active');
            e.target.classList.add('active');
            const tabName = e.target.dataset.tab;
            document.getElementById(`${tabName}-form`).classList.add('active');
        }
    });

    loginForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = loginForm['login-email'].value;
        const password = loginForm['login-password'].value;
        signInWithEmailAndPassword(auth, email, password)
            .catch(err => alert(`Login Failed: ${err.message}`));
    });

    registerForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = registerForm['register-email'].value;
        const password = registerForm['register-password'].value;
        const displayName = registerForm['register-username'].value;

        if (!email.endsWith('@regallakeland.com')) {
            alert("Registration is only allowed with a @regallakeland.com email address.");
            return;
        }

        createUserWithEmailAndPassword(auth, email, password)
            .then(userCredential => {
                return updateProfile(userCredential.user, { displayName });
            })
            .then(() => {
                alert("Registration successful! Welcome.");
            })
            .catch(err => alert(`Registration Failed: ${err.message}`));
    });

    logoutBtn.addEventListener('click', () => {
        signOut(auth).catch(err => alert(`Logout Failed: ${err.message}`));
    });

    forgotPasswordLink.addEventListener('click', e => {
        e.preventDefault();
        const email = prompt("Please enter your email to reset your password:");
        if (email) {
            sendPasswordResetEmail(auth, email)
                .then(() => alert("Password reset email sent!"))
                .catch(err => alert(`Error: ${err.message}`));
        }
    });
    
    adminDashboardBtn.addEventListener('click', () => {
        window.location.href = 'admin.html';
    });

    // --- Post Management ---

    const fetchPosts = async () => {
        const postsCol = collection(db, 'posts');
        const q = query(postsCol, orderBy('createdAt', 'desc'));
        const postSnapshot = await getDocs(q);
        allPosts = postSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPosts();
    };

    const renderPosts = () => {
        contentArea.innerHTML = '';
        const filteredPosts = currentCategory === 'all' 
            ? allPosts 
            : allPosts.filter(post => post.category === currentCategory);

        if (filteredPosts.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            filteredPosts.forEach(post => {
                const postElement = viewToggle.checked ? createMarketplaceCard(post) : createForumItem(post);
                postElement.addEventListener('click', () => showDetailView(post.id));
                contentArea.appendChild(postElement);
            });
        }
    };
    
    viewToggle.addEventListener('change', renderPosts);
    
    categoryList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
            document.querySelector('.category-list li.active').classList.remove('active');
            e.target.classList.add('active');
            currentCategory = e.target.dataset.category;
            renderPosts();
        }
    });

    const createMarketplaceCard = (post) => {
        const card = document.createElement('div');
        card.className = 'post-card';
        card.innerHTML = `
            <div class="post-image" style="background-image: url(${post.imageUrls?.[0] || 'https://via.placeholder.com/300'})"></div>
            <div class="post-content">
                <h3>${post.title}</h3>
                <p>${post.price ? `$${post.price}` : 'FREE'}</p>
                <small>By: ${post.authorName}</small>
            </div>
        `;
        return card;
    };

    const createForumItem = (post) => {
        const item = document.createElement('div');
        item.className = 'forum-item';
        item.innerHTML = `
            <div class="post-content">
                <h3>${post.title}</h3>
                <small>By: ${post.authorName} in #${post.category}</small>
            </div>
            <div class="post-meta">
                <span>${post.createdAt.toDate().toLocaleDateString()}</span>
            </div>
        `;
        return item;
    };

    // --- Post Modal Logic ---
    createPostBtn.addEventListener('click', () => {
        postForm.reset();
        modalTitle.textContent = 'Create New Post';
        imagePreviews.innerHTML = '';
        postForm['post-id'].value = '';
        postModal.style.display = 'flex';
    });

    closePostModalBtn.addEventListener('click', () => {
        postModal.style.display = 'none';
    });

    let filesToUpload = [];
    postImagesInput.addEventListener('change', (e) => {
        filesToUpload = Array.from(e.target.files).slice(0, 4);
        imagePreviews.innerHTML = '';
        filesToUpload.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = document.createElement('img');
                img.src = event.target.result;
                imagePreviews.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    });

    postForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return alert("You must be logged in to post.");

        savePostBtn.disabled = true;
        savePostBtn.textContent = 'Saving...';

        try {
            const imageUrls = [];
            for (const file of filesToUpload) {
                const storageRef = ref(storage, `posts/${Date.now()}_${file.name}`);
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);
                imageUrls.push(url);
            }

            const postId = postForm['post-id'].value;
            const postData = {
                title: postForm['post-title'].value,
                description: postForm['post-description'].value,
                price: postForm['post-price'].value || 0,
                location: postForm['post-location'].value,
                contact: postForm['post-contact'].value,
                category: postForm['post-category'].value,
                authorId: currentUser.uid,
                authorName: currentUser.displayName,
                imageUrls: imageUrls,
                createdAt: Timestamp.now()
            };

            if (postId) {
                // Update existing post
                const postRef = doc(db, 'posts', postId);
                await updateDoc(postRef, postData);
                alert("Post updated successfully!");
            } else {
                // Create new post
                await addDoc(collection(db, 'posts'), postData);
                alert("Post created successfully!");
            }

            postModal.style.display = 'none';
            fetchPosts(); // Refresh posts

        } catch (error) {
            console.error("Error saving post: ", error);
            alert(`Error saving post: ${error.message}`);
        } finally {
            savePostBtn.disabled = false;
            savePostBtn.textContent = 'Save Post';
        }
    });

    // --- Detail View Logic ---
    const showDetailView = async (postId) => {
        const postRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(postRef);

        if (docSnap.exists()) {
            const post = { id: docSnap.id, ...docSnap.data() };
            detailViewModal.style.display = 'flex';
            detailViewContent.innerHTML = createDetailViewHtml(post);
            
            // Add event listeners for edit/delete if user is author or admin
            if (currentUser && (currentUser.uid === post.authorId || ADMIN_UIDS.includes(currentUser.uid))) {
                document.getElementById('edit-post-btn').addEventListener('click', () => editPost(post));
                document.getElementById('delete-post-btn').addEventListener('click', () => deletePost(post.id, post.imageUrls));
            }
            
        } else {
            alert("Post not found!");
        }
    };

    const createDetailViewHtml = (post) => {
        let imagesHtml = '';
        if (post.imageUrls && post.imageUrls.length > 0) {
            imagesHtml = `<div id="detail-images">${post.imageUrls.map(url => `<img src="${url}" alt="Post image">`).join('')}</div>`;
        }
        
        let adminControls = '';
        if(currentUser && (currentUser.uid === post.authorId || ADMIN_UIDS.includes(currentUser.uid))){
             adminControls = `
                <div class="post-actions">
                    <button id="edit-post-btn" class="btn">Edit</button>
                    <button id="delete-post-btn" class="btn danger">Delete</button>
                </div>
            `;
        }

        return `
            ${adminControls}
            <p><strong>Category:</strong> #${post.category}</p>
            <p><strong>Author:</strong> ${post.authorName}</p>
            <p><strong>Price:</strong> ${post.price ? `$${post.price}` : 'FREE'}</p>
            ${post.location ? `<p><strong>Location:</strong> ${post.location}</p>` : ''}
            ${post.contact ? `<p><strong>Contact:</strong> ${post.contact}</p>` : ''}
            <hr>
            <p>${post.description.replace(/\n/g, '<br>')}</p>
            ${imagesHtml}
        `;
    };
    
    const editPost = (post) => {
        detailViewModal.style.display = 'none';
        postModal.style.display = 'flex';
        modalTitle.textContent = 'Edit Post';

        postForm['post-id'].value = post.id;
        postForm['post-title'].value = post.title;
        postForm['post-description'].value = post.description;
        postForm['post-price'].value = post.price;
        postForm['post-location'].value = post.location;
        postForm['post-contact'].value = post.contact;
        postForm['post-category'].value = post.category;
        
        imagePreviews.innerHTML = ''; // Note: Editing doesn't currently re-show old images
        filesToUpload = [];
    };

    const deletePost = async (postId, imageUrls) => {
        if (!confirm("Are you sure you want to delete this post? This cannot be undone.")) return;

        try {
            // Delete Firestore document
            await deleteDoc(doc(db, 'posts', postId));

            // Delete images from Storage
            if (imageUrls && imageUrls.length > 0) {
                for (const url of imageUrls) {
                    const imageRef = ref(storage, url);
                    await deleteObject(imageRef).catch(err => console.warn("Could not delete image: ", err));
                }
            }
            alert("Post deleted.");
            detailViewModal.style.display = 'none';
            fetchPosts();

        } catch (error) {
            console.error("Error deleting post: ", error);
            alert(`Error: ${error.message}`);
        }
    };

    closeDetailBtn.addEventListener('click', () => {
        detailViewModal.style.display = 'none';
    });
    
});
