// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyB6IAiH6zILQKuJRuXc55Q4hEX8q6F2kxE",
  authDomain: "regal-lakeland-marketplace.firebaseapp.com",
  projectId: "regal-lakeland-marketplace",
  storageBucket: "regal-lakeland-marketplace.firebasestorage.app",
  messagingSenderId: "1014346693296",
  appId: "1:1014346693296:web:fc76118d1a8db347945975"
};


// Admin accounts (full control)
export const ADMIN_EMAILS = [
  "michael.h@regallakeland.com",
  "janni.r@regallakeland.com",
  "chrissy.h@regallakeland.com",
  "amy.m@regallakeland.com"
];


// Forum / Marketplace sections
export const SECTION_GROUPS = [

  {
    title: "Marketplace",
    sections: [
      {
        id: "free-items",
        name: "Free Items",
        desc: "Post giveaways, free items, and curb alerts."
      },
      {
        id: "buy-sell",
        name: "Buy / Sell",
        desc: "Sell items to coworkers or look for something specific."
      },
      {
        id: "garage-sales",
        name: "Garage Sales",
        desc: "Weekend sales, moving sales, and neighborhood finds."
      }
    ]
  },

  {
    title: "Community",
    sections: [
      {
        id: "events",
        name: "Events",
        desc: "Birthdays, barbecues, outings, and employee meetups."
      },
      {
        id: "work-news",
        name: "Work News",
        desc: "Announcements, updates, reminders, and dealership info."
      },
      {
        id: "services",
        name: "Services",
        desc: "Promote side work, referrals, and help offered."
      }
    ]
  }

];


// View modes (OfferUp style + Forum style)
export const DEFAULT_TABS = [
  {
    id: "offerup",
    name: "Marketplace View"
  },
  {
    id: "forum",
    name: "Forum View"
  }
];


// Profanity detection (admin alert trigger)
export const PROFANITY_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "motherfucker",
  "cunt",
  "dick",
  "pussy",
  "fag",
  "nigger"
];
