Version 2 complete package

Upload ALL files in this ZIP to the root of your GitHub repo:
- index.html
- admin.html
- styles.css
- firebase-config.js
- app.js
- admin.js
- firestore.rules
- storage.rules

After upload:
1. In Firebase Authentication, enable Email/Password.
2. In Authentication > Settings > Authorized domains, add regallakeland.github.io
3. In Firestore, publish firestore.rules
4. In Storage, publish storage.rules

This build uses:
- verified @regallakeland.com emails only
- Firebase Auth
- Firestore listings + profiles
- Firebase Storage image uploads
- edit/delete own posts
- mark sold
- replies
- admin pin/delete/ban at admin.html


Fix 1:
- clearer image upload errors
- post modal closes after successful save
- save button disables while posting
