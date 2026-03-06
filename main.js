import { auth, db, storage } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updateProfile
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
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
    orderBy
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { 
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

// --- DOM Elements ---
const authView = document.getElementById('auth-view');
const mainView = document.getElementById('main-view');
const detailView = document.getElementById('detail-view');
const adminView = document.getElementById('admin-view');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const contentArea = document.getElementById('content-area');
const postModal = document.getElementById('post-modal');

let currentUser = null;

// --- Authentication --- 
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        document.body.classList.remove('login-page-background');
        authView.style.display = 'none';
        mainView.style.display = 'block';
        document.getElementById('user-display').textContent = `Welcome, ${user.displayName || user.email}`;
        checkAdminStatus(user);
        loadPosts();
    } else {
        currentUser = null;
        document.body.classList.add('login-page-background');
        authView.style.display = 'block';
        mainView.style.display = 'none';
        adminView.style.display = 'none';
        detailView.style.display = 'none';
    }
});

document.getElementById('register-btn').addEventListener('click', async () => {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const username = document.getElementById('register-username').value;

    if (!email.endsWith('@regallakeland.com')) {
        alert("Registration is only for @regallakeland.com emails.");
        return;
    }
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: username });
        // You might want to store the username in Firestore as well
        console.log('User registered and profile updated');
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    signInWithEmailAndPassword(auth, email, password)
        .catch(error => alert(error.message));
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

document.getElementById('forgot-password-link').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    if (email) {
        sendPasswordResetEmail(auth, email)
            .then(() => alert('Password reset email sent!'))
            .catch(error => alert(error.message));
    } else {
        alert('Please enter your email address first.');
    }
});

// --- Post Management ---
async function loadPosts() {
    contentArea.innerHTML = '';
    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(postsQuery);
    querySnapshot.forEach(doc => {
        renderPost(doc.data(), doc.id);
    });
}

function renderPost(data, id) {
    const isMarketplace = document.getElementById('view-toggle').checked;
    const postElement = document.createElement('div');
    postElement.className = isMarketplace ? 'post-card' : 'forum-item';
    postElement.dataset.id = id;

    let innerHTML = `<h3>${data.title}</h3>`;
    if (isMarketplace) {
        innerHTML += `<img src="${data.imageUrls?.[0] || 'https://via.placeholder.com/280x180'}" alt="Post image" class="post-image">`;
        if (data.price) {
            innerHTML += `<div class="price-badge">$${data.price}</div>`;
        } else {
            innerHTML += `<div class="price-badge free-badge">FREE</div>`;
        }
    }
    if (data.sold) {
        innerHTML += `<div class="sold-badge">SOLD</div>`;
    }
    
    postElement.innerHTML += innerHTML;
    postElement.addEventListener('click', () => showPostDetail(id));
    contentArea.appendChild(postElement);
}

// --- View Switching ---
document.getElementById('view-toggle').addEventListener('change', () => {
    contentArea.className = document.getElementById('view-toggle').checked ? 'marketplace-grid' : 'forum-list';
    loadPosts();
});

// --- Modal Logic ---
const modalTitle = document.getElementById('modal-title');
const postIdInput = document.getElementById('post-id');
const postTitleInput = document.getElementById('post-title');
const postDescriptionInput = document.getElementById('post-description');
const postPriceInput = document.getElementById('post-price');
const postLocationInput = document.getElementById('post-location');
const postContactInput = document.getElementById('post-contact');
const postCategorySelect = document.getElementById('post-category');
const postImagesInput = document.getElementById('post-images');
const imagePreviews = document.getElementById('image-previews');

document.getElementById('create-post-btn').addEventListener('click', () => {
    modalTitle.textContent = 'Create Post';
    postIdInput.value = '';
    loginForm.reset(); // Assuming you have a form element
    imagePreviews.innerHTML = '';
    postModal.style.display = 'block';
});

document.querySelector('.close-btn').addEventListener('click', () => postModal.style.display = 'none');

document.getElementById('save-post-btn').addEventListener('click', async () => {
    const postId = postIdInput.value;
    const files = postImagesInput.files;
    let imageUrls = [];

    if (files.length > 0) {
        for (const file of files) {
            const storageRef = ref(storage, `posts/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            imageUrls.push(url);
        }
    }

    const postData = {
        title: postTitleInput.value,
        description: postDescriptionInput.value,
        price: postPriceInput.value ? parseFloat(postPriceInput.value) : null,
        location: postLocationInput.value,
        contact: postContactInput.value,
        category: postCategorySelect.value,
        authorId: currentUser.uid,
        authorName: currentUser.displayName,
        createdAt: new Date(),
        imageUrls: imageUrls,
        sold: false,
    };

    if (postId) {
        const postRef = doc(db, 'posts', postId);
        await updateDoc(postRef, postData);
    } else {
        await addDoc(collection(db, 'posts'), postData);
    }

    postModal.style.display = 'none';
    loadPosts();
});

async function showPostDetail(postId) {
    const postRef = doc(db, 'posts', postId);
    const docSnap = await getDoc(postRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        let imagesHTML = '';
        if (data.imageUrls && data.imageUrls.length > 0) {
            data.imageUrls.forEach(url => {
                imagesHTML += `<img src="${url}" alt="Post image">`;
            });
        }

        let detailHTML = `
            <div class="post-detail-content">
                <button id="back-to-main">Back</button>
                <h2>${data.title}</h2>
                <div id="detail-images">${imagesHTML}</div>
                <p>${data.description}</p>
                <p><strong>Price:</strong> ${data.price ? `$${data.price}` : 'Free'}</p>
                <p><strong>Location:</strong> ${data.location}</p>
                <p><strong>Contact:</strong> ${data.contact}</p>
                <p><em>Posted by ${data.authorName}</em></p>
                ${currentUser.uid === data.authorId || await checkAdminStatus(currentUser, true) ? 
                    `<button id="edit-post-btn">Edit</button>
                     <button id="toggle-sold-btn">${data.sold ? 'Mark as Unsold' : 'Mark as Sold'}</button>
                     <button id="delete-post-btn" class="danger-btn">Delete</button>` : ''}
                <div id="comments-section"></div>
            </div>`;

        detailView.innerHTML = detailHTML;
        mainView.style.display = 'none';
        detailView.style.display = 'block';

        document.getElementById('back-to-main').addEventListener('click', () => {
            detailView.style.display = 'none';
            mainView.style.display = 'block';
            loadPosts();
        });

        // Add event listeners for edit/delete/sold if they exist
        document.getElementById('edit-post-btn')?.addEventListener('click', () => editPost(docSnap));
        document.getElementById('delete-post-btn')?.addEventListener('click', () => deletePost(postId));
        document.getElementById('toggle-sold-btn')?.addEventListener('click', () => toggleSoldStatus(postId, data.sold));

    }
}

function editPost(postDoc) {
    const data = postDoc.data();
    modalTitle.textContent = 'Edit Post';
    postIdInput.value = postDoc.id;
    postTitleInput.value = data.title;
    postDescriptionInput.value = data.description;
    postPriceInput.value = data.price;
    postLocationInput.value = data.location;
    postContactInput.value = data.contact;
    postCategorySelect.value = data.category;
    imagePreviews.innerHTML = '';
    if (data.imageUrls) {
        data.imageUrls.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            imagePreviews.appendChild(img);
        });
    }
    postModal.style.display = 'block';
}

async function deletePost(postId) {
    if (confirm('Are you sure you want to delete this post?')) {
        await deleteDoc(doc(db, 'posts', postId));
        detailView.style.display = 'none';
        mainView.style.display = 'block';
        loadPosts();
    }
}

async function toggleSoldStatus(postId, currentStatus) {
    const postRef = doc(db, 'posts', postId);
    await updateDoc(postRef, { sold: !currentStatus });
    showPostDetail(postId); // Refresh detail view
}


// --- Admin Check ---
const ADMIN_UIDS = ['YOUR_UID_1', 'YOUR_UID_2']; // Replace with actual Admin UIDs
async function checkAdminStatus(user, isCheck = false) {
    const isAdmin = ADMIN_UIDS.includes(user.uid);
    if (isCheck) return isAdmin;

    const adminBtn = document.getElementById('admin-dashboard-btn');
    if (isAdmin) {
        adminBtn.style.display = 'block';
        adminBtn.addEventListener('click', () => {
            mainView.style.display = 'none';
            adminView.style.display = 'block';
            // You would have a function in admin.js to load admin data
            // loadAdminDashboard(); 
        });
    } else {
        adminBtn.style.display = 'none';
    }
}