# Regal Employee Marketplace — Enterprise Build (No-CLI Friendly)

## What this build includes
- Email + password accounts
- Email verification required (@regallakeland.com only)
- First/Last name prompt (posts show name, not email)
- Boards (sidebar) + search + sort
- Posts with optional photo upload (Firebase Storage)
- Threads: replies on every post
- In-app notifications when someone replies to your post
- Admin portal at /adminregal/ (only admin emails can access)
  - delete any post
  - ban/unban users

## 1) Upload files to your host
If you're using GitHub Pages:
- Put everything in the root of your repo (keep the folders)
- Keep images in: /Images/regal1.jpg regal2.jpg regal3.jpg  (capital I)

## 2) Firebase Console setup (no command prompt)
### A) Authentication
Firebase Console → Authentication → Sign-in method → Enable **Email/Password**

### B) Firestore
Firebase Console → Firestore Database → Create database (Production mode ok)
Then go to **Rules** and paste the contents of `firestore.rules` → Publish.

### C) Storage (for item photos)
Firebase Console → Storage → Get started
Then go to **Rules** and paste the contents of `storage.rules` → Publish.

### D) Add your Firebase config to firebase-config.js
Firebase Console → Project settings → Your apps → Web app config
Paste values into `firebase-config.js`.

## 3) Admin portal
- Admin link appears for admin accounts after login
- Direct URL: /adminregal/

## Notes
- IP address is not exposed to static web apps. To log IPs you need a backend (Cloud Functions / reverse proxy).
