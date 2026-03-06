# Regal Employee Marketplace Blueprint

## Overview

This document outlines the plan, design, and features of the Regal Employee Marketplace application. The goal is to create a modern, visually appealing, and functional web application for Regal employees to browse and post items in a marketplace.

## Current Plan

The current plan is to build the application from the ground up, based on the provided screenshot. This includes:

1.  **Creating the main application files:** `index.html`, `style.css`, and `main.js`.
2.  **Designing the UI:** Implementing a dark theme, with a clean and modern layout, as seen in the screenshot.
3.  **Implementing core features:**
    *   User authentication (Login/Sign Up).
    *   A marketplace view with search, filter, and sort functionalities.
    *   A "Boards" section for categorizing items.
    *   An admin page for managing the marketplace.
4.  **Setting up Firebase:** Configuring Firebase for authentication, database, and storage.
5.  **Creating a zip archive:** Packaging all the project files into a zip file for easy download.

## Design and Style

The application will feature a modern and bold design aesthetic:

*   **Layout:** A responsive layout that works on both desktop and mobile devices.
*   **Color Palette:** A dark theme with a primary color for highlights and interactive elements.
*   **Typography:** A clean, sans-serif font for readability.
*   **Iconography:** Modern icons to enhance user experience.
*   **Interactivity:** Smooth transitions and animations for a polished feel.

## Features

### User Authentication

*   **Login/Sign Up:** Users can create an account and log in with their email and password.
*   **Session Management:** The application will keep users logged in across sessions.
*   **Verified Email:** The system will be designed to support email verification in a future iteration.

### Marketplace

*   **Item Grid:** Display of marketplace items in a grid layout.
*   **Search:** Users can search for items by title and description.
*   **Filtering:** Items can be filtered by status (e.g., Active, Sold).
*   **Sorting:** Items can be sorted by different criteria (e.g., Pinned, Newest).

### Admin Panel

*   A dedicated admin panel (`admin.html`) for managing users and marketplace items.

## File Structure

*   `index.html`: Main application entry point.
*   `style.css`: All styles for the application.
*   `main.js`: Core application logic.
*   `admin.html`: Admin panel.
*   `admin.js`: Logic for the admin panel.
*   `firebase-config.js`: Firebase configuration.
*   `firestore.rules`: Firestore security rules.
*   `storage.rules`: Firebase Storage security rules.
*   `blueprint.md`: This document.
*   `Images/`: Folder for images.
