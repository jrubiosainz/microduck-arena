import { CanvasTexture, SRGBColorSpace } from "three";

let assets;
export function loadGymBranding() {
  assets ??= Promise.all([
    ...["/duck-head-mark.webp", "/branding/pollen.svg", "/branding/hugging-face.svg"].map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    }),
    document.fonts.load('400 200px "Anton"'),
    document.fonts.load('700 200px "DM Sans"'),
  ]).then(([arena, pollen, huggingFace]) => ({ arena, pollen, huggingFace }));
  return assets;
}

export function sponsorTexture(brand, images) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = brand === "arena" ? "#101018" : "#faf8f2";
  ctx.fillRect(0, 0, 2048, 512);
  const image = images[brand];
  const size = Math.min(360 / image.naturalWidth, 360 / image.naturalHeight);
  const w = image.naturalWidth * size;
  const h = image.naturalHeight * size;
  ctx.drawImage(image, 85 + (360 - w) / 2, (512 - h) / 2, w, h);
  ctx.textBaseline = "middle";
  if (brand === "arena") {
    ctx.font = '400 215px "Anton"';
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("MICRODUCK", 540, 160, 1400);
    ctx.fillStyle = "#ff7a2f";
    ctx.fillText("ARENA", 540, 362, 1400);
  } else {
    ctx.fillStyle = "#19232c";
    ctx.font = '700 185px "DM Sans"';
    ctx.fillText(brand === "pollen" ? "Pollen Robotics" : "Hugging Face", 520, 268, 1430);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

export function floorLogoTexture(image) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const scale = 960 / Math.max(image.naturalWidth, image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (1024 - w) / 2, (1024 - h) / 2, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}
