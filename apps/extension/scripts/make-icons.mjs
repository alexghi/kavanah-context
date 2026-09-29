#!/usr/bin/env node
/**
 * Generates public/icon/{16,32,48,128}.png: a rounded indigo square with a white "K" made of
 * rectangles (a stem plus two rotated bars). Pure Node: a minimal PNG encoder on top of zlib.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 128];
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icon");
const BACKGROUND = [79, 70, 229]; // indigo-600 (#4f46e5)
const GLYPH = [255, 255, 255];
const SUPERSAMPLE = 4; // per axis -> 16 samples per pixel
const CORNER_RADIUS = 0.22; // fraction of the icon size

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Geometry (unit square, y down) ----------------------------------------

function inRoundedSquare(x, y, radius) {
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius <= 0;
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Rectangle of the given thickness whose axis runs from (ax, ay) to (bx, by). */
function inRotatedRect(x, y, ax, ay, bx, by, thickness) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const px = x - ax;
  const py = y - ay;
  const along = px * ux + py * uy;
  const across = Math.abs(-px * uy + py * ux);
  return along >= 0 && along <= length && across <= thickness / 2;
}

const K = {
  stem: [0.3, 0.24, 0.425, 0.76],
  upperArm: { from: [0.39, 0.5], to: [0.7, 0.24], thickness: 0.125 },
  lowerArm: { from: [0.39, 0.5], to: [0.72, 0.76], thickness: 0.125 },
};

function inGlyph(x, y) {
  return (
    inRect(x, y, ...K.stem) ||
    inRotatedRect(x, y, ...K.upperArm.from, ...K.upperArm.to, K.upperArm.thickness) ||
    inRotatedRect(x, y, ...K.lowerArm.from, ...K.lowerArm.to, K.lowerArm.thickness)
  );
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let glyph = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!inRoundedSquare(x, y, CORNER_RADIUS)) continue;
          covered++;
          if (inGlyph(x, y)) glyph++;
        }
      }
      const alpha = covered / samples;
      const glyphWeight = covered > 0 ? glyph / covered : 0;
      const offset = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[offset + c] = Math.round(BACKGROUND[c] * (1 - glyphWeight) + GLYPH[c] * glyphWeight);
      }
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
