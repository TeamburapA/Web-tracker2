/**
 * ui.js — micro-interactions (auth focus, decorative)
 */
document.querySelectorAll("form .field").forEach((field) => {
  const input = field.querySelector("input");
  if (!input) return;
  input.addEventListener("focus", () => field.classList.add("field--focus"));
  input.addEventListener("blur", () => field.classList.remove("field--focus"));
});
