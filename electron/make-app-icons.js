#!/usr/bin/env node
// Uygulama ikonlarini (PWA + masaustu) uretir. Bagimlilik istemedigimiz icin
// PNG/ICO'yu elle yaziyoruz (bkz. make-tray-icons.js).
//
//   node electron/make-app-icons.js
//
// Sekil: "Ofis Karakteri" konsepti — mevcut Minecraft Steve kafasinin yerine,
// ayni 12x12 piksel-grid mantiginda ama Claude turuncusu kep + tepede kivilcim +
// altta yaka ile "bu Claude" diyen bir versiyon.
//
// Ciktilar icons/ altina: icon-512.png, icon-192.png, icon-maskable-512.png,
//                         apple-touch-icon.png (180px), icon.ico (16/32/48/256)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- png yazici

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor + alpha
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const off = y * (width * 4 + 1);
    raw[off] = 0; // filter: none
    rgba.copy(raw, off + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ico yazici
// Vista+ ICO, PNG-encoded girdileri dogrudan kabul eder — BMP donusumune gerek yok.

function encodeIco(images) {
  // images: [{ size, png }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dirEntries = [];
  const dataChunks = [];
  let offset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // height
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    dataChunks.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...dataChunks]);
}

// ---------------------------------------------------------------- grid ciz

const CAP = hex('#B85C38'); // kep
const SPARK = hex('#F0B429'); // kivilcim
const SKIN = hex('#F0C9A0');
const EYE = hex('#141413');
const WHITE = hex('#FAF9F5');
const MOUTH = hex('#B8896A');
const COLLAR = hex('#3A3D42');
const BG = hex('#0E0F10');

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 12x12 "Ofis Karakteri" — mineClaude Logo Konseptleri artifact'indeki Konsept 01.
const GRID = [
  [CAP, CAP, CAP, CAP, SPARK, SPARK, SPARK, SPARK, CAP, CAP, CAP, CAP],
  [CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP],
  [CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP],
  [CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP, CAP],
  [SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN],
  [SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN],
  [SKIN, WHITE, EYE, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, EYE, WHITE, SKIN],
  [SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN],
  [SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN],
  [SKIN, SKIN, SKIN, SKIN, MOUTH, MOUTH, MOUTH, MOUTH, SKIN, SKIN, SKIN, SKIN],
  [SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN, SKIN],
  [COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR, COLLAR],
];

const N = GRID.length; // 12

// size: cikti kenari (px). safeFrac: karakterin kenara oranla ne kadarini kaplayacagi
// (maskable ikonlar icin ~0.7, digerleri icin ~1 / neredeyse tam kenar).
function render(size, safeFrac = 0.98) {
  const cell = Math.max(1, Math.floor((size * safeFrac) / N));
  const drawn = cell * N;
  const pad = Math.floor((size - drawn) / 2);
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      out[o] = BG[0]; out[o + 1] = BG[1]; out[o + 2] = BG[2]; out[o + 3] = 255;
    }
  }

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const [r, g, b] = GRID[gy][gx];
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const py = pad + gy * cell + y;
          const px = pad + gx * cell + x;
          if (py < 0 || px < 0 || py >= size || px >= size) continue;
          const o = (py * size + px) * 4;
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }
      }
    }
  }
  return out;
}

function renderPng(size, safeFrac) {
  return encodePng(size, size, render(size, safeFrac));
}

// ---------------------------------------------------------------- yaz

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });

const targets = [
  ['icon-512.png', 512, 0.98],
  ['icon-192.png', 192, 1],
  ['apple-touch-icon.png', 180, 1],
  ['icon-maskable-512.png', 512, 0.72],
];

for (const [name, size, safeFrac] of targets) {
  fs.writeFileSync(path.join(dir, name), renderPng(size, safeFrac));
  console.log('  ' + path.join('icons', name) + '  ' + size + 'px');
}

const ico = encodeIco([16, 32, 48, 256].map((size) => ({ size, png: renderPng(size, 0.98) })));
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log('  ' + path.join('icons', 'icon.ico') + '  16/32/48/256px');
