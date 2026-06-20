/**
 * PWA / favicon icon generator (DOC-24 §2.2 / §6). Rasterizes the brand mark
 * `public/icons/LOGO.PNG` (transparent navy+red star) into every icon the app
 * needs. Run: `node scripts/generate-icons.mjs`.
 *
 * Decision (Henry, 2026-06): favicon stays TRANSPARENT; the installed-app icons
 * (Android `maskable` tiles + iOS apple-touch) get a solid WHITE background so
 * the navy/red star keeps full contrast and iOS doesn't paint black behind the
 * transparency.
 *
 * Source is 300×300 with the mark touching all four edges (0px margin), so each
 * target shrinks the logo into a safe-zone:
 *   · `any` tiles  → 80% on a rounded white card
 *   · `maskable`   → 70% on a full-bleed white square (Android clips to a circle)
 *   · apple-touch  → 80% on a full white square (iOS rounds the corners itself)
 *   · favicon      → 94% on transparent (browser tab)
 * For a perfectly crisp 512px result, export the master at 1024×1024; from 300px
 * the two 512 tiles are upscaled ~1.4× (fine for flat art, slightly soft on the
 * thin inner star).
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve("public/icons/LOGO.PNG");
const ICONS = path.resolve("public/icons");
const APP = path.resolve("src/app");

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** Composite the logo (scaled to `fgScale`, centered) over a background. */
async function compose({ size, fgScale, bg = "white", rounded = false, out }) {
  const fg = Math.round(size * fgScale);
  const logo = await sharp(SRC)
    .resize(fg, fg, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  let base;
  if (bg === "transparent") {
    base = sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } });
  } else if (rounded) {
    const rx = Math.round(size * 0.22); // ~iOS/Android squircle radius
    const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="#FFFFFF"/></svg>`;
    base = sharp(Buffer.from(card));
  } else {
    base = sharp({ create: { width: size, height: size, channels: 4, background: WHITE } });
  }

  const offset = Math.round((size - fg) / 2);
  const buf = await base
    .composite([{ input: logo, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (out) await writeFile(out, buf);
  return buf;
}

/** Notification badge: white silhouette on transparent (the OS tints the glyph).
 * The source mark sits on an opaque WHITE disc, so the alpha channel is just a
 * circle — useless as a glyph. Instead we color-key the *ink* (navy/red pixels,
 * luminance < 200) and fill it white, leaving the white disc/inner-star as holes.
 * Result: a star+swoosh silhouette the OS can tint. */
async function badge({ size, out }) {
  const fg = Math.round(size * 0.92);
  const { data, info } = await sharp(SRC)
    .resize(fg, fg, { fit: "contain", background: TRANSPARENT })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2], a = data[i * channels + 3];
    const ink = a > 128 && 0.299 * r + 0.587 * g + 0.114 * b < 200;
    px[i * 4] = 255;
    px[i * 4 + 1] = 255;
    px[i * 4 + 2] = 255;
    px[i * 4 + 3] = ink ? a : 0;
  }
  const glyph = await sharp(px, { raw: { width, height, channels: 4 } }).png().toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: glyph, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/** Wrap a single PNG buffer in a minimal (PNG-embedded) .ico container. */
async function writeIco({ pngBuffer, out }) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width (32px)
  entry.writeUInt8(32, 1); // height (32px)
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of PNG data
  entry.writeUInt32LE(22, 12); // offset (6 + 16)
  await writeFile(out, Buffer.concat([header, entry, pngBuffer]));
}

await mkdir(ICONS, { recursive: true });

// PWA manifest icons + push badge (referenced by manifest.webmanifest / sw.ts).
await compose({ size: 192, fgScale: 0.8, rounded: true, out: path.join(ICONS, "icon-192.png") });
await compose({ size: 512, fgScale: 0.8, rounded: true, out: path.join(ICONS, "icon-512.png") });
await compose({ size: 192, fgScale: 0.7, out: path.join(ICONS, "maskable-192.png") });
await compose({ size: 512, fgScale: 0.7, out: path.join(ICONS, "maskable-512.png") });
await badge({ size: 72, out: path.join(ICONS, "badge-72.png") });

// Next.js file-convention icons (app/): tab favicon (transparent) + apple-touch (white).
await compose({ size: 48, fgScale: 0.94, bg: "transparent", out: path.join(APP, "icon.png") });
await compose({ size: 180, fgScale: 0.8, out: path.join(APP, "apple-icon.png") });

// Classic /favicon.ico for direct browser requests — 32px transparent star.
const favPng = await compose({ size: 32, fgScale: 0.94, bg: "transparent" });
await writeIco({ pngBuffer: favPng, out: path.join(APP, "favicon.ico") });

console.log("icons: done — manifest tiles, maskable, badge, app/icon.png, app/apple-icon.png, favicon.ico");
