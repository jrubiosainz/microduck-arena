import {
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import { bubbleAt } from "./crowd-behaviour.js";
export function crowdBubbles(placed) {
  const group = new Group();
  group.name = "crowd-bubbles";
  const maps = new Map(
    ["GO!", "QUACK!"].map((word) => {
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 176;
      const c = canvas.getContext("2d");
      c.fillStyle = "#fff8d8";
      c.strokeStyle = "#20252b";
      c.lineWidth = 7;
      c.beginPath();
      c.roundRect(5, 5, 374, 136, 30);
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(170, 139);
      c.lineTo(184, 168);
      c.lineTo(208, 139);
      c.fill();
      c.stroke();
      c.fillStyle = "#20252b";
      c.font = 'bold 70px "DM Sans", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(word, 192, 77);
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      return [word, map];
    }),
  );
  const sprites = Array.from({ length: 3 }, () => {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: maps.get("GO!"),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    sprite.center.set(0.5, 0);
    sprite.scale.set(0.34, 0.156, 1);
    group.add(sprite);
    return sprite;
  });
  return {
    group,
    pose(seconds, amounts) {
      sprites.forEach((sprite, i) => {
        const cue = bubbleAt(seconds, i, placed.length);
        sprite.visible = Boolean(cue);
        if (!cue) return;
        const seat = placed[cue.seat],
          rise = amounts[cue.seat];
        sprite.material.map = maps.get(cue.word);
        sprite.material.opacity = cue.opacity;
        sprite.position.set(seat.x, seat.y + 0.2 + rise * 0.075, seat.z);
      });
    },
    dispose() {
      group.removeFromParent();
      sprites.forEach((s) => s.material.dispose());
      maps.forEach((m) => m.dispose());
    },
  };
}
