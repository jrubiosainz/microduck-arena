// The caption panel under the booth: the charter's ink panel with a yellow
// name tile and up to two lines. The split: 42 characters or
// less stay on one line, longer ones break at the word boundary that
// balances the two lines' widths. A line the panel has no room for is not
// drawn at all, and the panel keeps what it has.

const ONE_LINE_CHARS = 42;

/** The caption's one or two lines, or null when no split of it fits. */
export function splitCaption(text, measure, maxWidth) {
  if (text.length <= ONE_LINE_CHARS && measure(text) <= maxWidth) return [text];
  const words = text.split(" ");
  const candidates = words
    .slice(1)
    .map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")])
    .map((lines) => ({ lines, widths: lines.map(measure) }))
    .filter(({ widths }) => widths.every((w) => w <= maxWidth))
    .sort((a, b) => Math.abs(a.widths[0] - a.widths[1]) - Math.abs(b.widths[0] - b.widths[1]));
  return candidates[0]?.lines ?? null;
}

export function createCaptions(container) {
  const panel = document.createElement("div");
  panel.className = "live-caption";
  panel.hidden = true;
  const name = document.createElement("span");
  name.className = "live-caption-name";
  const text = document.createElement("p");
  text.className = "live-caption-text";
  panel.append(name, text);
  container.append(panel);
  // Measured in the panel's own font, on a canvas so no layout is forced per
  // frame. The stage's width scales the type: 50 px at 1280.
  const ctx = document.createElement("canvas").getContext("2d");
  let width = 1280;
  let shown = null;
  const measure = (value) => {
    ctx.font = `700 ${(50 * width) / 1280}px "DM Sans", sans-serif`;
    return ctx.measureText(value).width;
  };
  return {
    resize(stageWidth) {
      width = stageWidth;
    },
    show(cue) {
      if (shown === cue) return;
      // Split before touching the panel: a caption that cannot fit leaves it as it was.
      const lines = ctx ? splitCaption(cue.text, measure, width - (96 * width) / 1280) : [cue.text];
      if (!lines) return;
      shown = cue;
      name.textContent = cue.name;
      text.replaceChildren();
      lines.forEach((line, i) => {
        if (i) text.append(document.createElement("br"));
        text.append(line);
      });
      panel.hidden = false;
    },
    hide() {
      shown = null;
      panel.hidden = true;
    },
  };
}
