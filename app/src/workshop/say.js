// A step's note: what it is doing in ink, what went wrong in orange (`bad`).

export function say(note, text, bad = false) {
  note.textContent = text;
  note.classList.toggle("bad", bad);
}
