#!/usr/bin/env node
// Menu bar ikonlarini uretir. Bagimlilik istemedigimiz icin PNG'yi elle yaziyoruz.
//
//   node electron/make-tray-icons.js
//
// Sekil: ofis gorunumundeki karakterin kafasi (office.js icindeki TORSO sprite'inin
// ilk 8 satiri). Menu bar ikonu template olmak zorunda — sistem onu duz siyaha ya da
// beyaza boyuyor, renk bilgisi kayboluyor. O yuzden sac/ten ayrimi yerine silueti
// alip gozleri ve agzi *delik* olarak birakiyoruz; 16 pikselde yuz boyle okunuyor.
//
// Ciktilar assets/ altina: trayTemplate.png (+@2x)  -> macOS template
//                          trayWaiting.png  (+@2x)  -> amber, biri input bekliyorken
//                          preview.png              -> sadece goz kontrolu icin buyuk hali

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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolor + alpha
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

// ---------------------------------------------------------------- kafa

// office.js'teki TORSO'nun kafa kismi, siluete cevrilmis:
//   #  dolu       .  bos
// Ust ve alt kosede birer piksel kirpik: kafa kare degil, yuvarlak okunuyor.
// Gozler 4. satirda (TORSO'daki 'E'), agiz 6. satirda ('M') — ikisi de delik.
const HEAD = [
  '.######.',
  '########',
  '########',
  '########',
  '##.##.##',
  '########',
  '###..###',
  '.######.',
];

const CELL = 8; // sprite 8x8 hucre

// size: cikti kenari (px). Hucre boyutu tam sayi olsun ki pixel art net kalsin,
// artan bosluk kenar payi olarak ortalanir.
function render(size, [r, g, b]) {
  const px = Math.max(1, Math.floor(size / (CELL + 1))); // 1 hucrelik pay birakiyoruz
  const drawn = px * CELL;
  const pad = Math.floor((size - drawn) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let cy = 0; cy < CELL; cy++) {
    for (let cx = 0; cx < CELL; cx++) {
      if (HEAD[cy][cx] !== '#') continue;
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          const o = ((pad + cy * px + y) * size + pad + cx * px + x) * 4;
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }
      }
    }
  }
  return encodePng(size, size, out);
}

// ---------------------------------------------------------------- yaz

const BLACK = [0, 0, 0];
const AMBER = [0xe0, 0x8c, 0x0c];

const dir = path.join(__dirname, 'assets');
fs.mkdirSync(dir, { recursive: true });

const files = [
  ['trayTemplate.png', 18, BLACK],
  ['trayTemplate@2x.png', 36, BLACK],
  ['trayWaiting.png', 18, AMBER],
  ['trayWaiting@2x.png', 36, AMBER],
  ['preview.png', 180, BLACK],
];

for (const [name, size, color] of files) {
  fs.writeFileSync(path.join(dir, name), render(size, color));
  console.log('  ' + path.join('electron/assets', name) + '  ' + size + 'px');
}
