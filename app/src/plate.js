// A name in a box, hung over a duck's head. Ported from Duck Jam,
// dome/web/features/replay/plate.mjs at 2d35443b — the nameplate only.

import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from "three";

/** Texture pixels per CSS pixel: enough that a duck walking up to the camera stays crisp. */
const TEXTURE = 3;
/** The box around a name, in CSS pixels: padding then border. */
const PLATE = { pad: [2, 7], border: 2 };

/** What the browser resolves for an element wearing these classes — the charter's own answer. */
function faceOf(classes) {
  const probe = document.createElement("span");
  probe.className = classes;
  probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const face = {
    font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    size: parseFloat(style.fontSize),
    line: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
    tracking: parseFloat(style.letterSpacing) || 0,
  };
  probe.remove();
  return face;
}

function sheet(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * TEXTURE);
  canvas.height = Math.ceil(height * TEXTURE);
  const paper = canvas.getContext("2d");
  paper.scale(TEXTURE, TEXTURE);
  return { canvas, paper };
}

function measured(paper, face, text) {
  paper.font = face.font;
  try {
    paper.letterSpacing = `${face.tracking}px`;
  } catch {
    // The tracking is the charter's polish, not its meaning.
  }
  return paper.measureText(text).width;
}

/**
 * A name in a box, hung by its bottom edge so it floats over a duck's head.
 * `pixels` is its height in CSS pixels and `ratio` its width over height, so
 * the caller can scale the sprite to a height in metres.
 */
export function nameplate(text, colour, background) {
  const face = faceOf("mono-label");
  const { pad, border } = PLATE;
  const probe = sheet(1, 1).paper;
  const width = measured(probe, face, text) + 2 * (pad[1] + border);
  const height = face.line + 2 * (pad[0] + border);
  const { canvas, paper } = sheet(width, height);
  paper.fillStyle = background;
  paper.fillRect(0, 0, width, height);
  paper.strokeStyle = colour;
  paper.lineWidth = border;
  paper.strokeRect(border / 2, border / 2, width - border, height - border);
  measured(paper, face, text);
  paper.fillStyle = colour;
  paper.textAlign = "center";
  paper.textBaseline = "middle";
  paper.fillText(text, width / 2, height / 2);

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.center.set(0.5, 0);
  return {
    sprite,
    pixels: height,
    ratio: width / height,
    dispose() {
      map.dispose();
      sprite.material.dispose();
    },
  };
}
