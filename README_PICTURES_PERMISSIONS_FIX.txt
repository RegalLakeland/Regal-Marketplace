PICTURES PERMISSIONS FIX

Why the error happened:
- pictures.js line 824 is only the catch block.
- The real failure is Firebase denying access to:
  1) Firestore document: picturePages/main-gallery
  2) Storage folder: picture-pages/{uid}/...
- Your current Firebase rules did not include those paths.

Files in this patch:
- pictures.html
- pictures.js
- firestore.rules
- storage.rules
- favicon.ico

What changed:
- Added Firestore rules for picturePages
- Added Storage rules for picture-pages uploads
- Locked picture editing/uploading to admins + Ariel
- Prevented non-editors from trying to auto-create the gallery doc
- Bumped pictures.js from v=1 to v=2 in pictures.html

Deploy:
1) Replace the files in your project
2) Deploy hosting/rules:
   firebase deploy --only firestore:rules,storage
3) Make sure favicon.ico is in the same public/root folder as index.html and pictures.html
4) Hard refresh: Ctrl+F5
