# Regal Lakeland Internal Marketplace & Forum - Blueprint

## 1. Project Overview

This document outlines the plan for creating a private, full-featured web application for Regal Lakeland employees. The application will serve as an internal marketplace for buying, selling, and exchanging items, and as a forum for discussions and announcements. It will be built using modern web technologies and will be powered by a robust Firebase backend.

## 2. Core Features

*   **Secure Authentication:**
    *   User registration and login restricted to `@regallakeland.com` email addresses.
    *   Secure password handling and "Forgot Password" functionality.
    *   Unique username/display name for each user.
    *   Hardcoded admin roles for whitelisted emails.
*   **Marketplace & Forum:**
    *   Users can create, edit, and manage posts (listings/threads).
    *   Posts will include titles, descriptions, categories, pricing, and multiple image uploads.
    *   A "FREE" tag will be automatically applied if no price is set.
    *   Users can mark their items as "Sold" or "Active."
    *   A commenting system will allow for replies on all posts.
*   **Dual-View User Interface:**
    *   **Marketplace View:** A modern, image-centric grid layout, similar to popular marketplace apps.
    *   **Forum View:** A traditional, category-based thread layout for discussions.
    *   A seamless toggle will allow users to switch between views.
    *   The entire UI will be fully responsive for both desktop and mobile devices.
*   **Admin Dashboard & Moderation:**
    *   A secure, admin-only dashboard.
    *   Admins can view all users and posts.
    *   Admins have the power to permanently delete any post and ban/unban users.
    *   An automated profanity filter will flag posts for admin review.
*   **Branding & Styling:**
    *   The app background will feature a rotating slideshow of Regal dealership images.
    *   A dark overlay will ensure text and UI elements are always readable.
    *   The overall design will be polished, modern, and aligned with a professional enterprise application.

## 3. Technical Stack

*   **Frontend:** HTML5, CSS3, JavaScript (ES6+ Modules)
    *   **UI:** Web Components (Custom Elements, Shadow DOM, Templates) for creating reusable, encapsulated UI elements.
    *   **Styling:** Modern CSS including Flexbox, Grid, Container Queries, and CSS Variables for a responsive and maintainable design.
*   **Backend:** Google Firebase
    *   **Authentication:** To manage user accounts and secure access.
    *   **Cloud Firestore:** As the primary NoSQL database for storing user data, posts, comments, and admin flags.
    *   **Cloud Storage for Firebase:** For hosting user-uploaded images.
*   **Project Structure:**
    *   `index.html`: Main entry point.
    *   `style.css`: All application styles.
    *   `main.js`: Core application logic, component definitions, and Firebase integration.
    *   `firestore.rules`: Security rules for the Firestore database.
    *   `storage.rules`: Security rules for Firebase Storage.
    *   `blueprint.md`: This document.
    *   `images/`: Directory for local images used in the UI.

## 4. Implementation Plan

1.  **Project Scaffolding:** Create the initial file and folder structure.
2.  **Firebase Setup:** Initialize a new Firebase project and configure Hosting, Auth, Firestore, and Storage.
3.  **HTML Structure:** Define the core HTML layout in `index.html` using `<template>` tags for the different views (Login, Main App, Post Details, Admin).
4.  **Authentication UI & Logic:**
    *   Build and style the login, registration, and password reset forms as web components.
    *   Implement the JavaScript logic to connect with Firebase Auth, enforcing the `@regallakeland.com` domain restriction and checking for unique display names.
5.  **Core App UI:**
    *   Develop the main application shell, including the header, navigation, and the view-toggle switch.
    *   Implement the background image slideshow.
6.  **Post & Commenting Features:**
    *   Create web components for `post-card` and `post-detail`.
    *   Write the Firestore logic to create, read, update, and list posts and comments.
    *   Integrate Firebase Storage for multi-image uploads.
7.  **Admin Dashboard:**
    *   Create an `admin-dashboard` web component, visible only to whitelisted admin users.
    *   Implement functions for deleting posts and banning/unbanning users.
    *   Add the profanity filter and flagging system.
8.  **Security Rules:** Write and deploy comprehensive `firestore.rules` and `storage.rules` to secure all user data and files.
9.  **Final Polish:** Thoroughly test all features, refine the UI/UX, and ensure full mobile responsiveness.
