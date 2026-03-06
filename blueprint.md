# Regal Lakeland Internal Marketplace & Forum - Blueprint

## 1. Project Overview

This document outlines the plan for creating a private, full-featured web application for Regal Lakeland employees. The application will serve as an internal marketplace for buying, selling, and exchanging items, and as a forum for discussions and announcements. It will be built using modern web technologies and will be powered by a robust Firebase backend, resulting in a polished, completely deployable product that feels like a real enterprise application.

## 2. Implemented Features & Design

### Core Functionality
*   **Secure Authentication:** User registration and login are restricted to `@regallakeland.com` email addresses, powered by Firebase Authentication. Includes "Forgot Password" and unique username validation.
*   **Admin Roles:** A hardcoded whitelist (`michael.h@regallakeland.com`, `janni.r@regallakeland.com`, `chrissy.h@regallakeland.com`, `amy.m@regallakeland.com`) grants access to a secure admin dashboard.
*   **Post Creation:** Users can create posts with title, description, price, location, contact info, multiple images, and select from categories: `Free Items`, `Buy / Sell`, `Garage Sales`, `Events`, `Work News`, `Services`.
*   **Dynamic Pricing:** If a price is omitted, a "FREE" badge is automatically displayed.
*   **Post Management:** Users can edit their own posts and toggle a "Sold" / "Active" status.
*   **Commenting System:** Users can reply to and comment on any post.

### User Interface & Experience
*   **Dual-View Layout:** A seamless toggle allows users to switch between:
    *   **Marketplace View (Default):** A modern, image-centric grid layout.
    *   **Forum View:** A traditional, category-based list layout.
*   **Responsive Design:** The application is fully responsive, ensuring a great experience on both desktop and mobile devices.
*   **Branding:** The background features a rotating slideshow of Regal dealership images with a dark overlay, ensuring text and UI elements are always readable and providing a polished, professional feel.
*   **Intuitive Navigation:** Clear navigation controls, modals for post creation, and a dedicated detail view for each post.

### Admin & Moderation
*   **Admin Dashboard:** A secure, admin-only area for application management.
*   **Admin Powers:** Admins can view all users and posts, permanently delete any post, and ban/unban users.
*   **Automated Profanity Filter:** A system automatically scans post content for profanity and flags it for admin review without blocking the post, ensuring a clean and professional environment.

## 3. Technical Stack

*   **Frontend:** HTML5, CSS3, JavaScript (ES6+ Modules)
*   **Backend:** Google Firebase (Authentication, Cloud Firestore, Cloud Storage)
*   **Project Structure:**
    *   `index.html`: Main application entry point with templates for each view.
    *   `style.css`: All styles, including responsive design and animations.
    *   `main.js`: Core application logic, component rendering, and user-facing Firebase interactions.
    *   `admin.js`: Logic for the admin dashboard and moderation features.
    *   `firebase-config.js`: Placeholder for the user's Firebase project configuration.
    *   `firestore.rules`: Security rules for the Firestore database.
    *   `storage.rules`: Security rules for Firebase Storage.
    *   `Images/`: Directory containing background slideshow images.
    *   `blueprint.md`: This document.

## 4. Current Plan: Project Scaffolding & Initial Build

**Status: IN PROGRESS**

1.  **Create Project Files:** Generate the complete file structure (`index.html`, `style.css`, `main.js`, `admin.js`, `firebase-config.js`, `firestore.rules`, `storage.rules`).
2.  **Populate HTML Structure:** Write the `index.html` with all necessary templates and elements for every view and feature.
3.  **Implement Styling:** Create the full `style.css`, including the background slideshow, responsive layouts, and modern enterprise aesthetics.
4.  **Add Firebase Configuration:** Create the `firebase-config.js` file.
5.  **Build Core Logic:** Implement all user-facing authentication and marketplace/forum logic in `main.js`.
6.  **Build Admin Logic:** Implement the admin dashboard, moderation tools, and profanity filter in `admin.js`.
7.  **Define Security Rules:** Write and save the secure, production-ready rules for Firestore and Storage.
8.  **Add Image Assets:** Create placeholder image files for the background slideshow.
