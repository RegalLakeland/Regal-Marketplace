Deploy steps for real admin Resend Verification Email:

1. Put your SMTP credentials into functions/.env or your deployment environment using the keys from functions/.env.example.
2. From this project root, deploy the function:
   firebase deploy --only functions:resendVerificationEmail
3. Replace the updated front-end files (app.js, admin.js, admin.html) on GitHub Pages.
4. Michael Hall and Janni Rivera will then see a 'Resend Verify Email' button in Admin for users whose email is still not verified.

Notes:
- The button sends a real verification email to the user.
- Normal users can also trigger the same backend resend for themselves from the login tab's 'Resend Verification Email' button.
- Manual 'Approve Email' remains as the backup override.
