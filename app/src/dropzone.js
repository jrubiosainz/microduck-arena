// Choosing a policy file: drop it, or browse for it.
//
// The drop target and the browse button set the same one piece of state, so the
// rest of the page never has to care which route a file arrived by.

export function createDropzone(container, { onFile } = {}) {
  container.innerHTML = `
    <div class="drop" id="drop" tabindex="0" role="button"
         aria-label="Choose a policy file, or drop one here">
      <input type="file" id="policy-file" accept=".onnx" hidden />
      <p class="drop__line" id="drop-line">Drop a <code>.onnx</code> policy here</p>
      <p class="drop__or">or <button type="button" class="link" id="browse">browse</button></p>
    </div>
  `;

  const drop = container.querySelector("#drop");
  const input = container.querySelector("#policy-file");
  const line = container.querySelector("#drop-line");
  let file = null;

  function take(next) {
    file = next;
    line.innerHTML = next
      ? `<strong>${next.name}</strong>`
      : 'Drop a <code>.onnx</code> policy here';
    onFile?.(next);
  }

  container.querySelector("#browse").addEventListener("click", () => input.click());
  drop.addEventListener("click", (e) => {
    if (e.target.id !== "browse") input.click();
  });
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => take(input.files[0] ?? null));

  for (const event of ["dragenter", "dragover"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add("drop--over");
    });
  }
  for (const event of ["dragleave", "drop"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.remove("drop--over");
    });
  }
  drop.addEventListener("drop", (e) => {
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) take(dropped);
  });

  return {
    get file() {
      return file;
    },
    clear: () => take(null),
  };
}
