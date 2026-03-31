This patch fixes two things:
1) Pictures page no longer depends on the new picturePages Firestore rules path.
   It now saves the standalone gallery into listings/pictures-home and uploads photos to images/{uid}/...
   so it works with the live marketplace paths you already use.
2) Admin page is restored to the polished dashboard version.

Important note for Ariel:
- Admins and moderators can edit the shared page.
- Ariel can open the studio, but if the shared page was originally created by another non-Ariel account,
  Firestore will only let Ariel save if she owns that page or has moderator/admin access.
