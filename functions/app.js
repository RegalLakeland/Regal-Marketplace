
// RSVP FIXED LOGIC
document.addEventListener("click", function(e){
  if(e.target.classList.contains("rsvp-btn")){
    const container = e.target.closest(".rsvp-container");
    const buttons = container.querySelectorAll(".rsvp-btn");

    // clear all
    buttons.forEach(btn => btn.classList.remove("active"));

    // toggle same click
    if(e.target.dataset.selected === "true"){
      e.target.dataset.selected = "false";
      return;
    }

    // set selected
    buttons.forEach(btn => btn.dataset.selected = "false");
    e.target.classList.add("active");
    e.target.dataset.selected = "true";
  }
});
