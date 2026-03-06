# Regal Lakeland Internal Marketplace & Forum - Blueprint

## 1. Project Overview

This document outlines the architecture, features, and implementation plan for a private internal marketplace and forum web application for Regal Lakeland employees. The application is a production-ready, mobile-responsive platform powered by Firebase, with a focus on security, usability, and a professional user experience.

## 2. Core Features & Functionality

### 2.1. User Authentication & Access Control

*   **Email Domain Restriction:** Account creation and login are strictly limited to users with an `@regallakeland.com` email address. This is enforced through Firebase Authentication and Firestore Security Rules.
*   **Unique Display Names:** Upon registration, users will provide a unique display name that will be associated with their profile and displayed on posts and comments.
*   **Admin Dashboard:** A hidden, secure admin dashboard is accessible only to a hardcoded whitelist of administrator emails: `michael.h@regallakeland.com`, `janni.r@regallakeland.com`, `chrissy.h@regallakeland.com`, and `amy.m@regallakeland.com`. Admin UIDs need to be updated in `main.js` and `firestore.rules`.

### 2.2. Post & Listing Management

*   **Create, Edit, & Mark as Sold:** Authenticated users can create new posts, edit their existing posts, and toggle the status of a post between "Active" and "Sold."
*   **Rich Post Content:** Each post supports:
    *   A descriptive title.
    *   A detailed description.
    *   Multiple image uploads (handled by Firebase Storage).
    *   A price field (displays as "FREE" if left blank).
    *   Location information.
    *   Contact information.
    *   A category selector (Free Items, Buy / Sell, Garage Sales, Events, Work News, Services).
*   **Commenting System:** Users can reply and comment on any post, creating a threaded discussion. Users cannot delete posts.

### 2.3. User Interface & Experience

*   **Dual View Modes:**
    *   **Marketplace View (Default):** An "OfferUp-style" grid of cards, with each card prominently displaying an image, title, price, and a "Sold" badge if applicable.
    *   **Forum View:** A traditional, list-based layout displaying post titles and metadata, suitable for discussions.
*   **Dynamic Background:** The login and main application views feature a rotating background slideshow using local images (`Images/regal1.jpg`, `Images/regal2.jpg`, `Images/regal3.jpg`) with a dark overlay to ensure text readability.
*   **Responsive Design:** The application is fully mobile-responsive, providing a seamless experience across desktops, tablets, and smartphones.
*   **Detailed Post View:** Clicking on a post opens a detailed view with a full image gallery, seller/author details, and the threaded comment section.

### 2.4. Administration & Moderation

*   **Admin Dashboard:** The admin dashboard provides the following capabilities:
    *   **Post Deletion:** Permanently delete any post from the platform.
    *   **User Management:** Ban or unban users, preventing them from logging in or interacting with the application.
    *   **Content Review:** Review content that has been flagged by a built-in profanity filter.
*   **Profanity Filter:** An automatic profanity filter is planned for a future iteration.

## 3. Technical Architecture & Implementation

### 3.1. Firebase Services

*   **Firebase Authentication:** For user registration, login, and session management.
*   **Cloud Firestore:** As the primary database for storing user profiles, posts, comments, and other application data.
*   **Firebase Storage:** For uploading and storing user-generated images.
*   **Firebase Hosting:** For deploying and serving the web application.

### 3.2. Frontend Development

*   **HTML5:** For the core structure and layout of the application (`index.html`, `admin.html`).
*   **CSS3:** For styling, including the responsive design, animations, and the dual-view layout (`style.css`).
*   **JavaScript (ES6+):** For all client-side logic, including Firebase integration, DOM manipulation, and user interactions (`main.js`, `admin.js`, `firebase-config.js`).

### 3.3. Security

*   **Firebase Security Rules:** Strict security rules have been implemented in `firestore.rules` and `storage.rules` to:
    *   Enforce the `@regallakeland.com` email domain restriction.
    *   Control read/write access to data based on user authentication and roles (user vs. admin).
    *   Ensure data integrity and prevent unauthorized access.

## 4. Current Implementation Details

*   **File Structure:** The project is organized into the following files:
    *   `index.html`: Main application entry point.
    *   `style.css`: All application styles.
    *   `main.js`: Core application logic.
    *   `firebase-config.js`: Firebase project configuration.
    *   `admin.html`: Admin dashboard UI.
    *   `admin.js`: Admin dashboard logic.
    *   `firestore.rules`: Firestore security rules.
    *   `storage.rules`: Firebase Storage security rules.
    *   `blueprint.md`: This document.

*   **Admin UIDs:** The UIDs for the admin users need to be manually added to the `ADMIN_UIDS` array in `main.js` and the `adminUIDs` array in `firestore.rules`.