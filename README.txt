Regal Employee Marketplace - Boss Demo Build

Files:
- index.html
- admin.html
- styles.css
- firebase-config.js
- app.js
- admin.js
- firestore.rules
- storage.rules

What this build includes:
- @regallakeland.com emails only
- unique usernames
- forgot password
- email verification required
- classic view + forum view toggle
- create / edit / delete your own posts
- admin delete any post
- admin portal
- ban / unban users
- profanity flagging stored in alerts
- multi-image upload
- background slideshow using Images/regal1.jpg regal2.jpg regal3.jpg

Important honest note:
- true automatic email-to-admin on profanity needs backend automation such as Cloud Functions or a third-party email provider
- real client IP logging also needs backend capture; the admin portal shows a placeholder because static Firebase pages cannot securely capture trusted IP data by themselves

Before demo:
1. Upload all files to the repo root.
2. Enable Email/Password in Firebase Authentication.
3. Add regallakeland.github.io to Authorized domains.
4. Publish firestore.rules.
5. Publish storage.rules.
6. Keep your Images folder with regal1.jpg regal2.jpg regal3.jpg.
