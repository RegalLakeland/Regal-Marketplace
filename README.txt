
Upload these files and folders to your GitHub repo:

index.html
styles.css
app.js
firebase-config.js
firestore.rules
storage.rules
adminregal/index.html
adminregal/admin.js

Then:
1) Open firebase-config.js and paste your real Firebase config
2) In Firebase Console:
   - Authentication -> Email/Password enabled
   - Authentication -> Authorized domains -> add regallakeland.github.io
   - Firestore -> Rules -> publish firestore.rules
   - Storage -> Rules -> publish storage.rules

Important:
- Admin URL for GitHub Project Pages is:
  https://regallakeland.github.io/REPO-NAME/adminregal/
  Your screenshot 404'd because it used /adminregal/ without the repo name in the middle.
- This build supports up to 10 images per post.
- Board counts are recalculated from the fetched listings, so the totals now line up correctly.
- Admin delete works both on the main site and inside adminregal/.
- Signup example name changed to Jordan Reyes.
