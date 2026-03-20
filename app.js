// === CRITICAL FIX PATCH (SAFE) ===

// Prevent crash from missing function
window.clearTempLoginContext = function () {
  console.log("clearTempLoginContext safely ignored");
};

// Fix missing name handler
window.handleSaveName = function () {
  const input = document.getElementById('displayNameInput');
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    alert('Please enter your name');
    return;
  }

  if (window.currentProfile) {
    window.currentProfile.displayName = name;
  }

  const overlay = document.getElementById('nameOverlay');
  if (overlay) overlay.style.display = 'none';

  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';

  console.log("Name saved:", name);
};

// Fix scroll lock on login
window.addEventListener("load", () => {
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

// === END FIX PATCH ===

// KEEP YOUR ORIGINAL CODE BELOW THIS LINE
