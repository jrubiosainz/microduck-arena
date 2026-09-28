// The two things every zone makes: a note under a step — what it is doing in
// ink, what went wrong in orange (`bad`) — and a button.

export function say(note, text, bad = false) {
  note.textContent = text;
  note.classList.toggle("bad", bad);
}

export function button(className, text, onClick, primary = false) {
  const b = Object.assign(document.createElement("button"), {
    type: "button", className: `button${primary ? "" : " button-secondary"} ${className}`, textContent: text,
  });
  b.addEventListener("click", onClick);
  return b;
}
