DELETE ACCOUNT PATCH NOTES

This patch adds protected admin account deletion support to the Regal Marketplace admin panel.

What was added:
- Delete Account button in admin user management
- Only michael.h@regallakeland.com and janni.r@regallakeland.com can delete accounts
- Protected core admin accounts cannot be deleted by the other admin
- Protected core admin accounts may only self-delete
- Deleting an account removes:
  - Firebase Authentication user
  - Firestore profile document
  - Firestore listings owned by that uid

Also included in this patch:
- Admin user-management UI cleanup
- Separate Email and Access status lines
- Relevant buttons only per user
- Compact actions layout kept
- Verified/manual-approved email can auto-grant access unless access was manually denied
- Firestore rules aligned closer to the current admin workflow

Important:
For Delete Account to work live, deploy BOTH:
1. Firebase Hosting / site files
2. Firebase Functions
3. Firestore rules

Typical deploy commands:
- firebase deploy --only hosting
- firebase deploy --only functions
- firebase deploy --only firestore:rules

Or deploy all together:
- firebase deploy
