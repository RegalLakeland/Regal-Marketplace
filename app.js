// GLOBAL FIX FOR handleSaveName
window.handleSaveName = function () {
  const nameInput = document.getElementById('displayNameInput');
  if (!nameInput) return;

  const name = nameInput.value.trim();
  if (!name) {
    alert('Please enter your name.');
    return;
  }

  try {
    if (window.currentProfile) {
      window.currentProfile.displayName = name;
    }
  } catch (e) {
    console.warn("Profile not ready yet");
  }

  const overlay = document.getElementById('nameOverlay');
  if (overlay) overlay.style.display = 'none';

  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';

  console.log("Name saved:", name);
};

// ===== KEEP YOUR EXISTING CODE BELOW THIS LINE =====
