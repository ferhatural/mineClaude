/* mineClaude — 3D ofis gorunumu (gercek izometri, voxel)
   office.js ile ayni sozlesme:  Office3D.render(list, container, T, lang)

   busy    -> kendi masasinda, klavyede
   waiting -> masasinin yaninda ayakta, el havada, yerde halka
   idle    -> lounge: kanepede tv/xbox izleyen, kahve makinesi basinda, kose sohbetleri

   Tasarim notlari:
   - Tek paylasilan BoxGeometry + memoize edilmis materyaller: ~500 mesh, ~20 materyal.
   - Derinlik siralamasi bedava (office.js'teki reorder() hack'i burada yok).
   - Kare hizi 30'a kilitli; sekme gizliyken veya kap gorunmezken hic cizmiyoruz.
   - Isimler WebGL'de degil, ustteki HTML katmanda: metin net kaliyor, ceviri bedava. */

import * as THREE from './vendor/three.module.min.js';

// ---------------------------------------------------------------- olculer
// 1 birim = 1 Minecraft "skin pikseli". Insan 32 birim (=~1.80 m).

const ROOM = { x0: -166, x1: 166, z0: -74, z1: 114, h: 46 };
const WALL_X = 46;                       // ofis / lounge ayirici duvar
const DOOR = { x: WALL_X, z: 10 };       // kapi boslugunun ortasi
const DOOR_Z0 = -4, DOOR_Z1 = 24;

const DESK_X = [-128, -70, -12];
const DESK_Z = [-34, 6, 46, 86];
const deskSlot = (i) => ({
  x: DESK_X[i % 3],
  z: DESK_Z[Math.floor(i / 3) % 4] + Math.floor(i / 12) * 8,
});

// lounge duraklari — office.js'teki LOUNGE dizisinin 3D karsiligi.
// rot: +Z'ye bakmak 0 radyan (kamera +X+Z'den bakiyor, yani 0 = yuz kameraya).
const LOUNGE = [
  { x: 100, z: 30, rot: Math.PI, prop: 'sit' },                 // kanepe sol — tv izliyor
  { x: 74, z: -38, rot: 0.6, prop: 'coffee' },                  // kahve makinesi basinda
  { x: 124, z: 30, rot: Math.PI, prop: 'sit' },                 // kanepe sag
  { x: 64, z: 66, rot: 1.107, prop: 'gossip', bub: true },      // sohbet A
  { x: 88, z: 78, rot: -2.034, prop: 'gossip' },                // A'nin karsisi
  { x: 152, z: -14, rot: -0.5, prop: 'coffee' },
  { x: 100, z: 104, rot: 0.2, prop: 'none' },
  { x: 60, z: 8, rot: 0.9, prop: 'coffee' },
  { x: 134, z: 96, rot: 2.07, prop: 'gossip', bub: true },      // sohbet B
  { x: 156, z: 84, rot: -1.07, prop: 'gossip' },                // B'nin karsisi
  { x: 152, z: 40, rot: -0.7, prop: 'coffee' },
  { x: 78, z: -8, rot: -0.3, prop: 'none' },
];

const SPEED = 34;          // birim / saniye
const FPS = 30;
const SEAT_COUCH = 10;     // kanepe oturaginin ust yuzeyi
const SEAT_CHAIR = 14;     // sandalye oturagi
const DESK_TOP = 16;

// ---------------------------------------------------------------- palet

const DARK = {
  bg: 0x16191e,
  floorA: 0x6a5c4c, floorB: 0x615343,
  wallA: 0x9a9183, wallB: 0xa69d8e, trim: 0x6f675b,
  glass: 0x5f93bd, glass2: 0x8fc0e0, frame: 0x2f333a,
  board: 0xd8dbe0, boardEdge: 0x8d735a, boardInk: 0x7b838f,
  deskTop: 0xa8763e, deskFront: 0x8a5f31, deskLeg: 0x6b4a26,
  mon: 0x2a2e35, screen: 0x3d7c8a, key: 0x3a3f47,
  sofa: 0x3f6fb5, sofa2: 0x35619f, rugA: 0x5d3536, rugB: 0x523032,
  leaf1: 0x4f9e4f, leaf2: 0x3f8a3f, leaf3: 0x5cb35c, pot: 0x8a5a33, pot2: 0x6d4526,
  machine: 0x3a3f47, machine2: 0x2c3037, mug: 0xe8e8e8, lamp: 0xe6c33f,
  tv: 0x1b1e24, tvScreen: 0x2f6f8a, xbox: 0x23262c, xled: 0x6fc24f,
  sky: 0xb8c2d2, ground: 0x5c5245, sun: 0xfff3e2, ambI: 0.82, sunI: 1.05,
};

const LIGHT = {
  bg: 0xffffff,
  floorA: 0xc8b49c, floorB: 0xbfa992,
  wallA: 0xcfd4db, wallB: 0xdde1e7, trim: 0xaab2be,
  glass: 0x9ec8e6, glass2: 0xcfe6f5, frame: 0xb9c1cb,
  board: 0xffffff, boardEdge: 0xb08f6f, boardInk: 0x98a0ac,
  deskTop: 0xc08d50, deskFront: 0xa2743d, deskLeg: 0x7f5a2f,
  mon: 0x5b616b, screen: 0x4f97a6, key: 0x8d949e,
  sofa: 0x5a88c9, sofa2: 0x4a78b8, rugA: 0x8e5a5a, rugB: 0x82504f,
  leaf1: 0x5fb35f, leaf2: 0x4d9c4d, leaf3: 0x74c874, pot: 0xa06b3d, pot2: 0x82552f,
  machine: 0x8d949e, machine2: 0x767d87, mug: 0xf6f6f6, lamp: 0xe6c33f,
  tv: 0x3a3f47, tvScreen: 0x4f97a6, xbox: 0x4a4f57, xled: 0x5cb35c,
  sky: 0xffffff, ground: 0xc9bdae, sun: 0xfffaf0, ambI: 0.95, sunI: 0.9,
};

// Minecraft yun renkleri — office.js ile birebir ayni, kimlik korunsun diye
const SHIRTS = [0x3fa7d6, 0xd6603f, 0x6fc24f, 0xa95fd6, 0xe6c33f, 0xd64f8a, 0x4f5fd6, 0xd0d4d9];
const SKINS = [0xf0c8a0, 0xe0ad82, 0xc08a5c, 0x98643c, 0xf7d9be];
const HAIRS = [0x2b2b33, 0x4a3728, 0x6b4a2f, 0x8a8f98, 0xc9a24d, 0x1f1f24];
const PANTS = [0x3b4dbb, 0x2f3f9c, 0x4a4a6a, 0x5a4b7a];
const SHOES = [0x46464e, 0x3a3a41, 0x33333a];

function hash(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const pick = (a, n) => a[n % a.length];
const shade = (hex, f) => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};
const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');

// ---------------------------------------------------------------- modul durumu

let C = DARK;                       // aktif palet
let renderer, scene, camera, sun, hemi, raycaster;
let root, labelBox, canvas, hint;   // DOM
let staticGroup, deskGroup, peopleGroup;
let deskCount = 0;
let deskScreens = [];   // slot sirasiyla monitor ekranlari
let T = (k) => k;
let ready = false;

const nodes = new Map();            // key -> { g, parts, at, path, ... }
const slotOf = new Map();

const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
const texCache = new Map();

function mat(color, opt) {
  const key = color + '|' + (opt || '');
  let m = matCache.get(key);
  if (m) return m;
  const o = { color };
  if (opt === 'emis') { o.emissive = color; o.emissiveIntensity = 0.45; }
  m = new THREE.MeshLambertMaterial(o);
  matCache.set(key, m);
  return m;
}

/* w,h,d = olculer;  x,z = merkez;  y = ALT yuzey (zemine koymak kolay olsun diye) */
function box(parent, w, h, d, x, y, z, color, opt) {
  const m = new THREE.Mesh(BOX, typeof color === 'number' ? mat(color, opt) : color);
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- doku uretimi

function pixTex(key, w, h, draw) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/* office.js'teki satir-dizisi sprite'lari burada 8x8 canvas dokusu oluyor:
   ayni kafa, ayni yuz, sadece artik gercek bir kupun onunde. */
function rowsTex(key, rows, pal) {
  return pixTex(key, rows[0].length, rows.length, (g) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const f = pal[row[x]];
        if (f == null) continue;
        g.fillStyle = hex6(f);
        g.fillRect(x, y, 1, 1);
      }
    });
  });
}

function tiledTex(key, w, h, repX, repZ, draw) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repZ);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/* monitor ekrani: statik, koyu editor goruntusu.
   Isiktan etkilenmesin diye Basic materyal — ekran kendi kendine parliyor. */
let screenMat = null, offMat = null;

/* bosta duran masanin monitoru: kapali, duz siyah */
function offScreen() {
  if (!offMat) offMat = new THREE.MeshBasicMaterial({ color: 0x0a0d11 });
  return offMat;
}

function editorScreen() {
  if (screenMat) return screenMat;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 60;
  const g = c.getContext('2d');
  g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, 96, 60);
  g.fillStyle = '#323842'; g.fillRect(0, 0, 7, 60);                  // etkinlik cubugu
  g.fillStyle = '#252526'; g.fillRect(7, 0, 21, 60);                 // kenar cubugu
  g.fillStyle = '#2d2d30'; g.fillRect(28, 0, 68, 6);                 // sekmeler
  g.fillStyle = '#1e1e1e'; g.fillRect(30, 0, 22, 6);
  g.fillStyle = '#007acc'; g.fillRect(0, 57, 96, 3);                 // durum cubugu
  g.fillStyle = '#6f7681';
  for (let i = 0; i < 4; i++) g.fillRect(2, 4 + i * 8, 3, 3);
  g.fillStyle = '#5a5f68';
  for (let i = 0; i < 11; i++) g.fillRect(10, 10 + i * 4, 6 + ((i * 7) % 13), 2);

  // kod satirlari: girinti + birkac renkli parca
  const pal = ['#c586c0', '#569cd6', '#4ec9b0', '#ce9178', '#dcdcaa', '#9cdcfe', '#6a9955'];
  const lines = [[0, 3, 5], [0, 2, 9, 4], [1, 4, 6], [2, 5, 3, 7], [2, 3, 8], [1, 6, 4],
                 [0, 0, 0], [1, 4, 7, 3], [2, 6, 5], [2, 3, 4, 6], [1, 5, 8], [0, 4, 6]];
  lines.forEach((ln, i) => {
    const y = 9 + i * 4;
    g.fillStyle = '#4a4f57'; g.fillRect(30, y, 3, 2);                // satir numarasi
    let x = 36 + ln[0] * 5;
    for (let k = 1; k < ln.length; k++) {
      if (!ln[k]) continue;
      g.fillStyle = pal[(i + k) % pal.length];
      g.fillRect(x, y, ln[k] * 2.4, 2);
      x += ln[k] * 2.4 + 3;
    }
  });

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  screenMat = new THREE.MeshBasicMaterial({ map: t });
  return screenMat;
}

/* tv ekrani: kendi kendine oynanan pong.
   Kucuk bir canvas'i her karede yeniden ciziyoruz — 96x54 RGBA, maliyeti yok denecek kadar az. */
const PW = 96, PH = 54;                      // ekran canvas'i (px)
const PAD_W = 3, PAD_H = 13, BALL = 3;
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111',
  '101101111001001', '111100111001111', '111100111101111', '111001001001001',
  '111101111101111', '111101111001111',
];
let pong = null;

function tvPong() {
  if (pong) return pong.mat;
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  pong = {
    mat: new THREE.MeshBasicMaterial({ map: t }),
    tex: t, g: c.getContext('2d'),
    bx: PW / 2, by: PH / 2, vx: 52, vy: 26,
    l: PH / 2, r: PH / 2, el: 0, er: 0, sl: 0, sr: 0, flash: 0,
  };
  serve(1);
  return pong.mat;
}

function serve(dir) {
  pong.bx = PW / 2; pong.by = PH / 2;
  pong.vx = 52 * dir;
  pong.vy = (Math.random() * 34 + 12) * (Math.random() < 0.5 ? -1 : 1);
  // her ralide raketlerin nisan hatasi degisiyor: bazen yetisemeyip sayi yiyorlar
  pong.el = (Math.random() - 0.5) * 15;
  pong.er = (Math.random() - 0.5) * 15;
}

function pongStep(dt) {
  const p = pong;
  p.bx += p.vx * dt;
  p.by += p.vy * dt;
  if (p.by < BALL / 2) { p.by = BALL / 2; p.vy = Math.abs(p.vy); }
  if (p.by > PH - BALL / 2) { p.by = PH - BALL / 2; p.vy = -Math.abs(p.vy); }

  // raketler topu kovaliyor ama hizlari sinirli
  const chase = (cur, err) => {
    const want = Math.max(PAD_H / 2, Math.min(PH - PAD_H / 2, p.by + err));
    const d = want - cur;
    return cur + Math.max(-44 * dt, Math.min(44 * dt, d));
  };
  p.l = chase(p.l, p.el);
  p.r = chase(p.r, p.er);

  // carpisma yalnizca top raketin onundeyken: yani gecirdiyse geri "yakalayamiyor"
  const hit = (padY) => Math.abs(p.by - padY) < PAD_H / 2 + BALL / 2;
  const lx = 2 + PAD_W, rx = PW - 2 - PAD_W;
  if (p.vx < 0 && p.bx - BALL / 2 <= lx && p.bx > lx - PAD_W && hit(p.l)) {
    p.bx = lx + BALL / 2; p.vx = -p.vx; p.vy += (p.by - p.l) * 1.7;
  }
  if (p.vx > 0 && p.bx + BALL / 2 >= rx && p.bx < rx + PAD_W && hit(p.r)) {
    p.bx = rx - BALL / 2; p.vx = -p.vx; p.vy += (p.by - p.r) * 1.7;
  }
  if (p.bx < -BALL) { p.sr = (p.sr + 1) % 10; p.flash = 0.5; serve(1); }
  if (p.bx > PW + BALL) { p.sl = (p.sl + 1) % 10; p.flash = 0.5; serve(-1); }
  p.vy = Math.max(-46, Math.min(46, p.vy));
  if (p.flash > 0) p.flash -= dt;

  draw();
}

function digit(g, n, x, y) {
  const rows = DIGITS[n];
  for (let i = 0; i < 15; i++)
    if (rows[i] === '1') g.fillRect(x + (i % 3) * 2, y + Math.floor(i / 3) * 2, 2, 2);
}

function draw() {
  const p = pong, g = p.g;
  g.fillStyle = p.flash > 0 ? '#16202a' : '#0b0e12';
  g.fillRect(0, 0, PW, PH);
  g.fillStyle = '#2c3b48';                               // orta cizgi
  for (let y = 2; y < PH - 2; y += 6) g.fillRect(PW / 2 - 1, y, 2, 3);
  g.fillStyle = '#7fd4e8';
  digit(g, p.sl, PW / 2 - 20, 4);
  digit(g, p.sr, PW / 2 + 14, 4);
  g.fillStyle = '#e8f1f5';
  g.fillRect(2, Math.round(p.l - PAD_H / 2), PAD_W, PAD_H);
  g.fillRect(PW - 2 - PAD_W, Math.round(p.r - PAD_H / 2), PAD_W, PAD_H);
  g.fillRect(Math.round(p.bx - BALL / 2), Math.round(p.by - BALL / 2), BALL, BALL);
  p.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- kafa dokulari
// TORSO'nun ilk 8 satiri office.js'te de kafa; birebir tasidik.
const HEAD_FRONT = [
  'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH',
  'SWESSEWS', 'SSSSSSSS', 'SSSMMSSS', 'SSSSSSSS',
];
const HEAD_SIDE = [
  'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HSSSSSSS',
  'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS',
];
const HEAD_BACK = [
  'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH',
  'HHHHHHHH', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS',
];
const HEAD_TOP = ['HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH',
  'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH'];

/* BoxGeometry materyal sirasi: +X, -X, +Y, -Y, +Z, -Z */
function headMaterials(skin, hair) {
  const key = 'h' + skin + '_' + hair;
  let m = matCache.get(key);
  if (m) return m;
  const pal = { H: hair, S: skin, W: 0xffffff, E: 0x2b2b33, M: shade(skin, 0.72) };
  const face = (n, rows) => new THREE.MeshLambertMaterial({ map: rowsTex(key + n, rows, pal) });
  m = [face('sr', HEAD_SIDE), face('sl', HEAD_SIDE), face('t', HEAD_TOP),
       new THREE.MeshLambertMaterial({ color: shade(skin, 0.8) }),
       face('f', HEAD_FRONT), face('b', HEAD_BACK)];
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- karakter

// bir kere kurulan, herkesin paylastigi hafif malzemeler
let steamMats = null, bubbleMats = null, ringMat = null, ringGeo = null;

function sharedProps() {
  steamMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({
    color: 0xcfd6de, transparent: true, opacity: 0, depthWrite: false,
  }));
  const bub = (id, txt) => new THREE.SpriteMaterial({
    map: pixTex('bub' + id, 32, 24, (g) => {
      g.fillStyle = '#f2f4f7';
      g.fillRect(1, 1, 30, 18);
      g.fillRect(3, 19, 4, 4);
      g.fillStyle = '#1d222b';
      g.font = 'bold 13px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, 16, 10);
    }),
    transparent: true, depthWrite: false,
  });
  bubbleMats = { wait: bub('q', '?'), gossip: bub('g', '···') };
  ringGeo = new THREE.RingGeometry(9, 12.5, 20);
  ringMat = new THREE.MeshBasicMaterial({
    color: 0xf2b53b, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
}

function buildPerson(s) {
  const n = hash(s.sessionId || s.pid);
  const shirt = pick(SHIRTS, n), skin = pick(SKINS, n >> 3);
  const hair = pick(HAIRS, n >> 6), pants = pick(PANTS, n >> 9);
  const shoe = pick(SHOES, n >> 12);
  // Herkes tek kalipti (genis kol, kisa sac) ve ofis bastan asagi ayni tipten
  // gorunuyordu. Minecraft'in Alex modeli gibi ince kollu + uzun sacli bir varyant
  // ekledik. Session'in hash'inden secildigi icin ayni session hep ayni gorunur.
  const femme = ((n >> 15) & 1) === 1;
  const armW = femme ? 3 : 4;

  const g = new THREE.Group();
  const body = new THREE.Group();          // govde + kollar: yururken zipliyor
  g.add(body);

  // Kafa kendi grubunda: sac kafayla birlikte donsun, kafa da govdeden bagimsiz
  // saga sola bakabilsin (lounge'da sohbet edenler icin).
  const headG = new THREE.Group();
  headG.position.set(0, 28, 0);
  body.add(headG);

  const head = new THREE.Mesh(BOX, headMaterials(skin, hair));
  head.scale.set(8, 8, 8);
  head.castShadow = true;
  headG.add(head);

  if (femme) {
    box(headG, 8.6, 11, 2, 0, -7, -5, hair);        // ense — omuza kadar inen sac
    box(headG, 1.4, 9, 8.4, -4.7, -5, 0, hair);     // yan tutamlar
    box(headG, 1.4, 9, 8.4, 4.7, -5, 0, hair);
  }

  box(body, 8, 12, 4, 0, 12, 0, shirt);    // govde

  const limb = (px) => {
    const p = new THREE.Group();
    p.position.set(px, 24, 0);
    body.add(p);
    return p;
  };
  const ax = 4 + armW / 2;
  const armL = limb(-ax), armR = limb(ax);
  for (const a of [armL, armR]) {
    box(a, armW, 9, armW, 0, -9, 0, shirt);      // kol
    box(a, armW, 3, armW, 0, -12, 0, skin);      // el
  }

  const leg = (px) => {
    const p = new THREE.Group();
    p.position.set(px, 12, 0);
    g.add(p);
    return p;
  };
  const legL = leg(-2), legR = leg(2);
  for (const l of [legL, legR]) {
    box(l, 4, 10, 4, 0, -10, 0, pants);
    box(l, 4, 2, 4, 0, -12, 0, shoe);
  }

  // kahve kupu — sag ele asili
  const mug = new THREE.Group();
  mug.position.set(0, -12.5, 2.5);
  box(mug, 4, 4, 4, 0, 0, 0, C.mug);
  box(mug, 1, 2, 1, 2.5, 1, 0, C.mug);
  // buhar kupun icinde ama kolla birlikte yatmasin diye ayri bir grupta:
  // her karede kolun donusu geri alaniyor, buhar hep yukari cikiyor
  const steamG = new THREE.Group();
  steamG.position.y = 2;
  [0, 1, 2].forEach((i) => {
    const m = new THREE.Mesh(BOX, steamMats[i]);
    m.position.set(i === 1 ? -1 : 1, 4 + i * 3, 0);
    steamG.add(m);
  });
  mug.add(steamG);
  mug.visible = false;
  armR.add(mug);

  const bubble = new THREE.Sprite(bubbleMats.wait);
  bubble.scale.set(14, 10.5, 1);
  bubble.position.set(6, 42, 0);
  bubble.visible = false;
  g.add(bubble);

  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.4;
  ring.visible = false;
  g.add(ring);

  g.userData.person = true;
  return { g, parts: { body, head: headG, armL, armR, legL, legR, mug, steamG, bubble, ring } };
}

// ---------------------------------------------------------------- kedi

// Ofis kedisi. Kimseye bagli degil, session sayisindan bagimsiz: lounge'da
// duraklar arasinda dolasir, varinca bir sure oturup kuyrugunu sallar.
// Duraklar elle secildi — rastgele nokta uretseydik kanepenin ya da sehpanin
// icinden gecerdi.
// Rastgele nokta ureten bir gezinme kanepenin, masanin, sirasi gelince masalarin
// icinden gecerdi; ustelik iki oda arasindaki duvari da delerdi. Onun yerine kapali
// bir tur: her durak bir oncekine duz cizgiyle bagli ve o cizgi bos zeminden geciyor.
// Ofis tarafindaki noktalar masa aralarindaki koridorlarda — x=25 / x=-41 / x=-99
// dikey kogusler, z=72 ve z=-58 yatay koridorlar (masa oturma alani z-9..z+21).
// Odalar arasi gecis her zaman kapinin (WALL_X, DOOR.z) uzerinden.
const CAT_ROUTE = [
  { x: 56, z: 16 },                    // lounge, kapinin yani
  { x: DOOR.x, z: DOOR.z },            // kapi
  { x: 25, z: 10 },                    // ofis: sag kogus
  { x: 25, z: 72 },
  { x: -41, z: 72 },                   // 3. ve 4. sira arasindaki koridor
  { x: -99, z: 72 },
  { x: -99, z: -58 },                  // sol kogus, pencere onu
  { x: 25, z: -58 },
  { x: 25, z: 10 },
  { x: DOOR.x, z: DOOR.z },            // kapidan lounge'a
  { x: 56, z: 16 },
  { x: 60, z: 60 },                    // lounge turu — mobilyanin disindan
  { x: 72, z: 100 },
  { x: 140, z: 100 },
  { x: 158, z: 60 },
  { x: 158, z: 4 },
  { x: 150, z: -24 },                  // saksinin (156,-46) ustunden degil, yanindan
  { x: 100, z: -46 },                  // tv'nin onu
];
const CAT_SPEED = 30;          // birim/sn — tur uzun, insanlardan biraz yavas
const CAT_FUR = 0xd08a3a, CAT_FUR2 = 0xb8722c, CAT_MUZZLE = 0xf2ddbe;

let cat = null;

function buildCat() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  box(body, 6, 5, 12, 0, 4, 0, CAT_FUR);              // govde (+Z one bakiyor)

  const headG = new THREE.Group();
  headG.position.set(0, 7.5, 6.5);
  body.add(headG);
  box(headG, 5, 5, 5, 0, -2.5, 0, CAT_FUR);
  box(headG, 3, 2, 1, 0, -1.5, 2.6, CAT_MUZZLE);      // burun
  box(headG, 1.4, 1.6, 1, -1.4, 2.5, 0, CAT_FUR2);    // kulaklar
  box(headG, 1.4, 1.6, 1, 1.4, 2.5, 0, CAT_FUR2);

  const leg = (px, pz) => {
    const l = new THREE.Group();
    l.position.set(px, 4, pz);
    g.add(l);
    box(l, 2, 4, 2, 0, -4, 0, CAT_FUR2);
    return l;
  };
  const legFL = leg(-2, 4), legFR = leg(2, 4), legBL = leg(-2, -4), legBR = leg(2, -4);

  const tail = new THREE.Group();
  tail.position.set(0, 7, -6);
  body.add(tail);
  box(tail, 1.6, 1.6, 7, 0, -0.8, -3.5, CAT_FUR2);
  tail.rotation.x = -0.5;

  g.position.set(CAT_ROUTE[0].x, 0, CAT_ROUTE[0].z);
  g.userData.cat = true;                 // isin testi bunu ariyor
  return {
    g,
    parts: { body, head: headG, legFL, legFR, legBL, legBR, tail },
    at: { ...CAT_ROUTE[0] },
    spot: 0,
    state: 'sit',
    wait: 2,
    rot: 0,
    rotGoal: 0,
    t: 0,
    pet: 0,                              // sevilme sayaci (saniye)
  };
}

// Kediye tiklandi: yurumeyi kesip oturur, kafasini kaldirir, kuyrugu diklenir.
// Ses index.html'de sentezleniyor ve ses ayarina bagli; gorsel tepki her zaman var,
// yoksa sesi kapali olan kullanici tiklaminin bir sey yaptigini hic anlamiyor.
function petCat() {
  if (!cat) return;
  cat.pet = 2.2;
  cat.state = 'sit';
  cat.wait = Math.max(cat.wait, 2.4);
  if (window.Office3D.onCatPet) window.Office3D.onCatPet();
}

function catStep(dt) {
  if (!cat) return;
  cat.t += dt;
  const p = cat.parts;

  if (cat.pet > 0) {
    cat.pet -= dt;
    const k = Math.min(1, cat.pet / 0.25);          // sonunda yumusak cikis
    p.body.position.y = -1.2;
    p.body.rotation.x = 0.16 - 0.1 * k;             // hafif geriye yaslanir
    p.legFL.rotation.x = 0; p.legFR.rotation.x = 0;
    p.legBL.rotation.x = -1.2; p.legBR.rotation.x = -1.2;
    p.head.rotation.x = -0.35 * k;                  // kafayi kaldirir
    p.head.rotation.y = Math.sin(cat.t * 3.5) * 0.18 * k;
    p.tail.rotation.x = -0.5 - 0.7 * k;             // kuyruk diklenir
    p.tail.rotation.y = Math.sin(cat.t * 7) * 0.5 * k;
    return;
  }

  if (cat.state === 'sit') {
    cat.wait -= dt;
    // otururken arka govde yere yakin, on ayaklar dik
    p.body.position.y = -1.2;
    p.body.rotation.x = 0.16;
    p.legFL.rotation.x = 0; p.legFR.rotation.x = 0;
    p.legBL.rotation.x = -1.2; p.legBR.rotation.x = -1.2;
    p.tail.rotation.x = -0.5;
    p.tail.rotation.y = Math.sin(cat.t * 1.6) * 0.55;
    p.head.rotation.x = 0;
    p.head.rotation.y = Math.sin(cat.t * 0.5) * 0.5;
    if (cat.wait <= 0) {
      // Turda hep bir sonraki duraga: atlarsa aradaki cizgi mobilyanin ya da
      // duvarin icinden gecer, tur bu sirayla guvenli.
      cat.spot = (cat.spot + 1) % CAT_ROUTE.length;
      const d = CAT_ROUTE[cat.spot];
      cat.rotGoal = Math.atan2(d.x - cat.at.x, d.z - cat.at.z);
      cat.state = 'walk';
    }
    return;
  }

  const d = CAT_ROUTE[cat.spot];
  const dx = d.x - cat.at.x, dz = d.z - cat.at.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.5) {
    cat.state = 'sit';
    // Kapi ve ara noktalarda oyalanmasin, sadece duraklarda otursun
    cat.wait = (d.x === DOOR.x && d.z === DOOR.z) ? 0 : 2 + Math.random() * 6;
    return;
  }
  const step = Math.min(dist, CAT_SPEED * dt);
  cat.at.x += (dx / dist) * step;
  cat.at.z += (dz / dist) * step;
  cat.g.position.set(cat.at.x, 0, cat.at.z);

  let turn = cat.rotGoal - cat.rot;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  cat.rot += turn * Math.min(1, dt * 6);
  cat.g.rotation.y = cat.rot;

  const k = Math.sin(cat.t * 11) * 0.6;
  p.legFL.rotation.x = k; p.legFR.rotation.x = -k;
  p.legBL.rotation.x = -k; p.legBR.rotation.x = k;
  p.body.position.y = Math.abs(Math.sin(cat.t * 11)) * 0.5;
  p.body.rotation.x = 0;
  p.tail.rotation.y = Math.sin(cat.t * 5) * 0.3;
  p.head.rotation.y = 0;
}

// ---------------------------------------------------------------- sahne parcalari

function makeFloor(p) {
  const w = ROOM.x1 - ROOM.x0, d = ROOM.z1 - ROOM.z0;
  const tex = tiledTex('floor', 2, 2, w / 44, d / 44, (g) => {
    g.fillStyle = hex6(C.floorA); g.fillRect(0, 0, 2, 2);
    g.fillStyle = hex6(C.floorB); g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((ROOM.x0 + ROOM.x1) / 2, 0, (ROOM.z0 + ROOM.z1) / 2);
  m.receiveShadow = true;
  p.add(m);
}

function makeWalls(p) {
  const w = ROOM.x1 - ROOM.x0, d = ROOM.z1 - ROOM.z0;
  const tex = tiledTex('brick', 16, 8, w / 40, ROOM.h / 16, (g) => {
    g.fillStyle = hex6(C.wallA); g.fillRect(0, 0, 16, 8);
    g.fillStyle = hex6(C.wallB);
    g.fillRect(0, 0, 7, 3); g.fillRect(8, 0, 7, 3);
    g.fillRect(4, 4, 7, 3); g.fillRect(-4, 4, 7, 3); g.fillRect(12, 4, 7, 3);
  });
  const wallMat = new THREE.MeshLambertMaterial({ map: tex });

  // arka duvar (-Z) ve sol duvar (-X): kameradan gorunmeyen yuzler zaten atlaniyor
  box(p, w, ROOM.h, 4, (ROOM.x0 + ROOM.x1) / 2, 0, ROOM.z0 - 2, wallMat);
  box(p, 4, ROOM.h, d, ROOM.x0 - 2, 0, (ROOM.z0 + ROOM.z1) / 2, wallMat);
  box(p, w, 2, 3, (ROOM.x0 + ROOM.x1) / 2, 0, ROOM.z0 + 1.5, C.trim);
  box(p, 3, 2, d, ROOM.x0 + 1.5, 0, (ROOM.z0 + ROOM.z1) / 2, C.trim);

  // ayirici duvar + kapi boslugu
  box(p, 5, 40, DOOR_Z0 - ROOM.z0, WALL_X, 0, (ROOM.z0 + DOOR_Z0) / 2, wallMat);
  box(p, 5, 40, ROOM.z1 - DOOR_Z1, WALL_X, 0, (DOOR_Z1 + ROOM.z1) / 2, wallMat);
  box(p, 5, 6, DOOR_Z1 - DOOR_Z0, WALL_X, 34, (DOOR_Z0 + DOOR_Z1) / 2, wallMat);  // kapi ustu kiris
}

function makeWindow(p, x, cols = 3) {
  const z = ROOM.z0 + 0.4;
  box(p, cols * 17 + 3, 24, 2, x, 18, z, C.frame);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < 2; j++)
      box(p, 15, 9, 1.4, x - (cols - 1) * 8.5 + i * 17, 20 + j * 10, z + 0.9,
        j === 1 && i === 0 ? C.glass2 : C.glass, 'emis');
}

function makeBoard(p, x) {
  const z = ROOM.z0 + 0.4;
  box(p, 60, 28, 2, x, 12, z, C.boardEdge);
  box(p, 54, 22, 1.4, x, 15, z + 0.8, C.board);
  box(p, 30, 2, 0.6, x - 8, 32, z + 1.6, C.boardInk);
  box(p, 40, 2, 0.6, x - 3, 27, z + 1.6, C.boardInk);
  box(p, 18, 2, 0.6, x - 14, 22, z + 1.6, C.boardInk);
}

function makePlant(p, x, z, s = 1) {
  box(p, 9 * s, 8 * s, 9 * s, x, 0, z, C.pot);
  box(p, 11 * s, 2 * s, 11 * s, x, 8 * s, z, C.pot2);
  box(p, 5 * s, 12 * s, 5 * s, x, 10 * s, z, C.leaf2);
  box(p, 14 * s, 6 * s, 14 * s, x, 16 * s, z, C.leaf1);
  box(p, 10 * s, 5 * s, 10 * s, x, 22 * s, z, C.leaf3);
  box(p, 5 * s, 4 * s, 5 * s, x, 27 * s, z, C.leaf1);
}

function makeDesk(p, x, z) {
  box(p, 34, 2, 18, x, DESK_TOP, z, C.deskTop);                 // tabla
  box(p, 32, 8, 2, x, 8, z - 8, C.deskFront);                   // on panel (uzak taraf)
  for (const dx of [-15, 15]) for (const dz of [-7, 7])
    box(p, 3, DESK_TOP, 3, x + dx, 0, z + dz, C.deskLeg);

  // monitor oturanin tam karsisinda duruyor (yaninda degil), hafif capraz
  const mon = new THREE.Group();
  mon.position.set(x - 2, 0, z - 3);
  mon.rotation.y = 0.12;
  box(mon, 7, 2, 7, 0, DESK_TOP + 2, 0, C.mon);
  box(mon, 3, 5, 3, 0, DESK_TOP + 4, 0, C.mon);
  box(mon, 20, 12, 2, 0, DESK_TOP + 8, 0, C.mon);
  const scr = box(mon, 17, 9.5, 1, 0, DESK_TOP + 9.2, 1.2, offScreen());
  p.add(mon);
  deskScreens.push(scr);

  box(p, 14, 1, 5, x - 2, DESK_TOP + 2, z + 5, C.key);          // klavye
  box(p, 3, 1.5, 4, x + 10, DESK_TOP + 2, z + 5, C.key);        // fare

  // sandalye — kisi masanin kamera tarafinda oturuyor
  const cx = x - 2, cz = z + 15;
  box(p, 12, 2, 12, cx, SEAT_CHAIR - 2, cz, C.mon);
  box(p, 12, 12, 2, cx, SEAT_CHAIR, cz + 5, C.mon);
  box(p, 3, SEAT_CHAIR - 2, 3, cx, 0, cz, C.deskLeg);
  box(p, 10, 1.5, 10, cx, 0, cz, C.mon);
}

function makeLounge(p) {
  // hali
  const rug = tiledTex('rug', 2, 2, 3, 2.2, (g) => {
    g.fillStyle = hex6(C.rugA); g.fillRect(0, 0, 2, 2);
    g.fillStyle = hex6(C.rugB); g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
  });
  const r = new THREE.Mesh(new THREE.PlaneGeometry(80, 62), new THREE.MeshLambertMaterial({ map: rug }));
  r.rotation.x = -Math.PI / 2;
  r.position.set(112, 0.15, 12);
  r.receiveShadow = true;
  p.add(r);

  // kanepe — tv'ye bakiyor (arkasi kameraya)
  const sx = 112, sz = 30;
  box(p, 52, 6, 20, sx, 4, sz, C.sofa);                  // oturak
  // sirt bilerek alcak: kanepe kameraya arkasini donuyor, yuksek sirt oturanlari yutuyor
  box(p, 52, 8, 5, sx, SEAT_COUCH, sz + 7.5, C.sofa2);
  box(p, 5, 10, 20, sx - 23.5, 4, sz, C.sofa2);          // kolcaklar
  box(p, 5, 10, 20, sx + 23.5, 4, sz, C.sofa2);
  for (const dx of [-22, 22]) for (const dz of [-8, 8])
    box(p, 3, 4, 3, sx + dx, 0, sz + dz, C.deskLeg);

  // sehpa + kupa
  box(p, 26, 2, 14, sx, 10, 4, C.deskTop);
  for (const dx of [-11, 11]) for (const dz of [-5, 5])
    box(p, 2.5, 10, 2.5, sx + dx, 0, 4 + dz, C.deskLeg);
  box(p, 4, 4, 4, sx - 6, 12, 4, C.mug);
  box(p, 1, 2, 1, sx - 3.5, 13, 4, C.mug);

  // tv sehpasi + tv (ekran +Z'ye, yani kameraya bakiyor)
  const tz = ROOM.z0 + 10;
  box(p, 40, 10, 12, sx, 0, tz, C.mon);
  box(p, 8, 2, 8, sx, 10, tz, C.tv);
  box(p, 44, 26, 3, sx, 12, tz, C.tv);
  box(p, 40, 22, 1.2, sx, 14, tz + 1.9, tvPong());

  // xbox — dikey duran siyah kule, ustunde yesil vantilator
  box(p, 9, 20, 9, sx + 26, 0, tz + 2, C.xbox);
  box(p, 6, 1, 6, sx + 26, 20, tz + 2, C.xled, 'emis');
  box(p, 6, 2, 2, sx + 26, 4, tz + 6.6, C.mon);          // kumanda gozu
  // yerde iki kumanda
  box(p, 6, 2, 3, sx - 8, 0.2, 14, C.xbox);
  box(p, 6, 2, 3, sx + 6, 0.2, 16, C.xbox);

  // kahve makinesi + tezgah
  const mx = 64, mz = ROOM.z0 + 9;
  box(p, 30, 14, 14, mx, 0, mz, C.machine2);
  box(p, 32, 2, 16, mx, 14, mz, C.deskTop);
  box(p, 14, 22, 11, mx, 16, mz, C.machine);
  box(p, 10, 6, 1, mx, 30, mz + 5.6, C.screen, 'emis');
  box(p, 8, 5, 6, mx, 17, mz + 3, C.machine2);
  box(p, 4, 4, 4, mx, 16.5, mz + 5, C.mug);
  box(p, 2, 2, 2, mx + 5, 34, mz + 4, C.lamp, 'emis');
  box(p, 4, 4, 4, mx + 12, 16, mz + 2, C.mug);
}

function buildStatic() {
  const p = new THREE.Group();
  makeFloor(p);
  makeWalls(p);
  makeWindow(p, -138);
  makeWindow(p, -8);
  makeWindow(p, 150, 2);
  makeBoard(p, -73);
  makeLounge(p);
  makePlant(p, -152, -50, 1.1);
  makePlant(p, 24, 100, 0.9);
  makePlant(p, 56, 100, 0.95);
  makePlant(p, 156, -46, 1);
  return p;
}

// ---------------------------------------------------------------- kamera

const CENTER = new THREE.Vector3(0, 12, 24);
const ELEV = Math.atan(1 / Math.SQRT2);     // 35.264° = gercek izometri
let azimuth = Math.PI / 4;
let zoom = 1;

function placeCamera() {
  const r = 600;
  const ch = Math.cos(ELEV) * r;
  camera.position.set(
    CENTER.x + Math.sin(azimuth) * ch,
    CENTER.y + Math.sin(ELEV) * r,
    CENTER.z + Math.cos(azimuth) * ch,
  );
  camera.lookAt(CENTER);
  camera.updateMatrixWorld(true);

  // odayi cerceveye sigdir: 8 kosesi kamera uzayinda ne kadar yer kapliyor?
  const inv = camera.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  let hw = 0, hh = 0;
  for (const x of [ROOM.x0, ROOM.x1])
    for (const y of [0, ROOM.h])
      for (const z of [ROOM.z0, ROOM.z1]) {
        v.set(x, y, z).applyMatrix4(inv);
        hw = Math.max(hw, Math.abs(v.x));
        hh = Math.max(hh, Math.abs(v.y));
      }
  hw *= 1.03; hh *= 1.05;
  const aspect = (canvas.clientWidth || 16) / (canvas.clientHeight || 9);
  if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
  camera.left = -hw; camera.right = hw;
  camera.top = hh; camera.bottom = -hh;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function attachControls() {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, a: azimuth, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    const tap = drag && drag.moved < 5;      // surukleme degil, tiklama
    drag = null;
    if (!tap) return;
    // kediye tiklamak karti acmiyor: sadece onu seviyor
    if (hitCat(e)) { petCat(); return; }
    // bos zemine tiklamak aciksa karti kapatiyor: onPick null ile de cagriliyor
    if (window.Office3D.onPick) window.Office3D.onPick(hit(e), e.clientX, e.clientY);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
      azimuth = drag.a + (e.clientX - drag.x) * 0.006;
      placeCamera();
      return;
    }
    hover(e);
  });
  canvas.addEventListener('pointerleave', () => { canvas.title = ''; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(4, Math.max(0.75, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    placeCamera();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { azimuth = Math.PI / 4; zoom = 1; placeCamera(); });
}

const ndc = new THREE.Vector2();
// Kedi peopleGroup'ta degil, dogrudan sahnede duruyor; isin testine ayrica katiliyor.
// Onunde bir karakter varsa o kazanir — kediye tiklarken yanlislikla kimsenin karti
// acilmasin diye en yakin isabete bakiyoruz.
function under(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const targets = cat ? peopleGroup.children.concat(cat.g) : peopleGroup.children;
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.key && !o.userData.cat) o = o.parent;
  return o || null;
}
const hit = (e) => { const o = under(e); return o ? o.userData.key : null; };
const hitCat = (e) => { const o = under(e); return !!(o && o.userData.cat); };
function hover(e) {
  const o = under(e);
  // kedinin kendi ipucu yok: uzerine gelince ne oldugunu soyleyelim, yoksa
  // tiklanabildigi yalnizca imlecin degismesinden anlasiliyor
  const tip = o ? (o.userData.cat ? T('petCat') : (o.userData.tip || '')) : '';
  if (canvas.title !== tip) canvas.title = tip;
  canvas.style.cursor = o ? 'pointer' : '';
}

// ---------------------------------------------------------------- kurulum

function themeIsDark() {
  return !window.matchMedia || !window.matchMedia('(prefers-color-scheme: light)').matches;
}

function init(container) {
  C = themeIsDark() ? DARK : LIGHT;
  matCache.clear();
  texCache.clear();
  nodes.clear();

  container.innerHTML = '';
  root = container;
  root.classList.add('of3');

  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvas = renderer.domElement;
  root.appendChild(canvas);

  labelBox = document.createElement('div');
  labelBox.className = 'of3-labels';
  root.appendChild(labelBox);

  hint = document.createElement('div');
  hint.className = 'of3-hint';
  root.appendChild(hint);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);

  hemi = new THREE.HemisphereLight(C.sky, C.ground, C.ambI);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(C.sun, C.sunI);
  // isik kameranin omzundan gelsin: ic duvar yuzleri (+X ve +Z) aydinlik kalsin,
  // golgeler de sahnenin arkasina dussun
  sun.position.set(210, 260, 140);
  sun.target.position.copy(CENTER);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230; sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 620;
  sun.shadow.bias = -0.002;
  scene.add(sun, sun.target);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1400);

  sharedProps();
  staticGroup = buildStatic();
  deskGroup = new THREE.Group();
  peopleGroup = new THREE.Group();
  scene.add(staticGroup, deskGroup, peopleGroup);
  cat = buildCat();
  scene.add(cat.g);
  deskCount = 0;

  raycaster = new THREE.Raycaster();
  attachControls();

  new ResizeObserver(resize).observe(root);
  resize();
  ready = true;
}

function mkLabel(cls) {
  const el = document.createElement('span');
  el.className = cls;
  labelBox.appendChild(el);
  return el;
}

function resize() {
  if (!root || !root.clientWidth) return;
  renderer.setSize(root.clientWidth, root.clientHeight, false);
  placeCamera();
}

function ensureDesks(n) {
  const want = Math.max(9, Math.ceil(n / 3) * 3);
  if (want === deskCount) return;
  deskGroup.clear();
  deskScreens = [];
  for (let i = 0; i < want; i++) {
    const { x, z } = deskSlot(i);
    makeDesk(deskGroup, x, z);
  }
  deskCount = want;
}

// ---------------------------------------------------------------- yerlesim

// s.asked: tur bitmis ama Claude soru sormus — 2D ofisle ayni, eli kaldirsin
const stateOf = (s) =>
  s.status === 'busy' ? 'busy'
    : s.status === 'waiting' ? 'wait'
      : (s.status === 'idle' && !s.cold) ? (s.asked ? 'wait' : 'ready') : 'idle';
const atDesk = (s) => stateOf(s) !== 'idle';
const keyOf = (s) => String(s.sessionId || s.pid);

function assignSlots(list, zone) {
  const used = new Set(), out = new Map();
  for (const s of list) {
    const k = keyOf(s), prev = slotOf.get(k);
    if (prev && prev.zone === zone && !used.has(prev.idx)) { used.add(prev.idx); out.set(k, prev.idx); }
  }
  let next = 0;
  for (const s of list) {
    const k = keyOf(s);
    if (out.has(k)) continue;
    while (used.has(next)) next++;
    used.add(next);
    out.set(k, next);
  }
  for (const [k, idx] of out) slotOf.set(k, { zone, idx });
  return out;
}

// ofis <-> lounge geciyorsa once kapiya ugra, yoksa duvarin icinden gecmis gibi oluyor
function pathTo(node, dest) {
  const p = [];
  if ((node.at.x < WALL_X) !== (dest.x < WALL_X)) p.push({ x: DOOR.x, z: DOOR.z });
  p.push(dest);
  return p;
}

function ensureNode(s, x, z, rot, prop, bub) {
  const key = keyOf(s);
  const st = stateOf(s);
  let node = nodes.get(key);
  if (!node) {
    const built = buildPerson(s);
    built.g.userData.key = key;
    built.g.position.set(x, 0, z);
    built.g.rotation.y = rot;
    peopleGroup.add(built.g);
    node = {
      g: built.g, parts: built.parts, at: { x, z }, dest: { x, z },
      rot, rotGoal: rot, path: null, walking: false, t: Math.random() * 10,
    };
    node.label = mkLabel('of3-name');
    nodes.set(key, node);
  }

  node.st = st;
  node.prop = prop;
  node.bub = !!bub;
  node.seen = true;
  node.dest = { x, z };
  node.slotRot = rot;
  // yururken rotGoal yurume yonu; 2 saniyede bir gelen render onu bozmasin
  if (!node.walking) node.rotGoal = rot;

  const name = String(s.project || '?');
  node.label.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
  node.label.className = 'of3-name' + (st === 'wait' ? ' wait' : '');

  const dispKey = st === 'wait' ? 'waiting' : st;
  node.g.userData.tip = `${s.project} — ${T(dispKey)}${s.waitingFor ? ' (' + s.waitingFor + ')' : ''}`;
  return node;
}

function applyDest(node) {
  const d = node.dest;
  const cur = node.path ? node.path[node.path.length - 1] : node.at;
  if (cur.x === d.x && cur.z === d.z) return;
  node.path = pathTo(node, d);
  node.walking = true;
}

// ---------------------------------------------------------------- animasyon

const stepPhase = (t) => (Math.floor(t * 5) % 2 ? 1 : -1);   // Minecraft usulu 2 kareli tak tak

function pose(node, dt) {
  node.t += dt;
  const t = node.t;
  const p = node.parts;
  const { st, prop } = node;
  const sit = prop === 'sit' || (st !== 'wait' && st !== 'idle');

  // yurume: adim + zipkin govde
  if (node.walking) {
    const k = stepPhase(t) * 0.55;
    p.legL.rotation.x = k; p.legR.rotation.x = -k;
    p.armL.rotation.x = -k * 0.8; p.armR.rotation.x = k * 0.8;
    p.body.position.y = stepPhase(t) > 0 ? 0.9 : 0;
    p.body.rotation.x = 0;
    p.armL.rotation.z = 0; p.armR.rotation.z = 0;
    p.mug.visible = false;
    p.bubble.visible = false;
    p.ring.visible = false;
    p.head.rotation.set(0, 0, 0);
    node.g.position.y = 0;
    return;
  }

  p.body.position.y = 0;
  node.g.position.y = sit ? (prop === 'sit' ? SEAT_COUCH : SEAT_CHAIR) - 12 : 0;

  if (sit) {
    p.legL.rotation.x = -1.4; p.legR.rotation.x = -1.4;
  } else {
    p.legL.rotation.x = 0; p.legR.rotation.x = 0;
  }

  if (st === 'busy') {
    // klavyede: kollar one-asagi, eller iki kareli tikirdiyor.
    // Aci klavyeye denk gelsin diye dar: daha genisi masaya kapaklanmis gibi duruyor.
    const k = stepPhase(t * 1.6) * 0.1;
    p.armL.rotation.x = -0.75 + k; p.armR.rotation.x = -0.75 - k;
    p.armL.rotation.z = 0; p.armR.rotation.z = 0;
    p.body.rotation.x = 0.06;
  } else if (st === 'wait') {
    p.armR.rotation.x = Math.PI * 0.97;
    p.armR.rotation.z = Math.sin(t * 6) * 0.4;
    p.armL.rotation.x = 0; p.armL.rotation.z = 0;
    p.body.rotation.x = 0;
  } else {
    const s = Math.sin(t * 1.7) * 0.09;
    p.armL.rotation.x = s; p.armR.rotation.x = -s;
    p.armL.rotation.z = 0;
    p.armR.rotation.z = 0;
    p.body.rotation.x = sit ? 0.05 : 0;
    if (prop === 'coffee') {
      // Kupa elde asili duruyordu ama kimse icmiyordu. ~7 saniyede bir yudum:
      // kol agza kalkar, kafa hafif geriye gider, sonra iner. node.t her kisi icin
      // rastgele basladigi icin herkes ayni anda icmiyor.
      const cyc = (t % 7) / 7;
      const sip = cyc > 0.72 ? Math.sin(((cyc - 0.72) / 0.28) * Math.PI) : 0;
      p.armR.rotation.x = -1.35 - sip * 0.9;
      p.armR.rotation.z = -0.25 + sip * 0.12;
      p.head.rotation.x = -sip * 0.22;
    }
  }

  // Lounge'daki herkes tas gibi duruyordu. Sohbet edenler karsilikli kafa cevirir,
  // digerleri arada etrafa bakar; yururken ve klavyedeyken kafa duz.
  if (!node.walking && st !== 'busy') {
    if (prop === 'gossip') {
      p.head.rotation.y = Math.sin(t * 0.75) * 0.45 + Math.sin(t * 2.3) * 0.06;
      p.head.rotation.x = Math.sin(t * 1.9) * 0.05;              // konusurken hafif bas sallama
    } else if (prop !== 'coffee') {
      p.head.rotation.y = Math.sin(t * 0.32) * 0.3;
      p.head.rotation.x = 0;
    } else {
      p.head.rotation.y = Math.sin(t * 0.4) * 0.15;
    }
  } else {
    p.head.rotation.set(0, 0, 0);
  }

  p.mug.visible = prop === 'coffee';
  p.steamG.rotation.x = -p.armR.rotation.x;
  p.bubble.visible = st === 'wait' || (prop === 'gossip' && node.bub);
  p.bubble.material = st === 'wait' ? bubbleMats.wait : bubbleMats.gossip;
  p.bubble.position.y = 42 + (Math.floor(t * 1.2) % 2 ? 1.5 : 0);
  p.ring.visible = st === 'wait';
}

function advance(node, dt) {
  if (node.path) {
    let left = SPEED * dt;
    while (left > 0 && node.path.length) {
      const p = node.path[0];
      const dx = p.x - node.at.x, dz = p.z - node.at.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= left) {
        node.at = { x: p.x, z: p.z };
        node.path.shift();
        left -= dist;
      } else {
        node.at = { x: node.at.x + (dx / dist) * left, z: node.at.z + (dz / dist) * left };
        node.rotGoal = Math.atan2(dx, dz);
        left = 0;
      }
    }
    if (!node.path.length) { node.path = null; node.walking = false; node.rotGoal = node.slotRot; }
    node.g.position.x = node.at.x;
    node.g.position.z = node.at.z;
  }
  // yumusak donus (en kisa yay)
  let d = node.rotGoal - node.rot;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  node.rot += d * Math.min(1, dt * 9);
  node.g.rotation.y = node.rot;
  pose(node, dt);
}

const proj = new THREE.Vector3();
const placed = [];
function updateLabels() {
  const w = root.clientWidth, h = root.clientHeight;
  placed.length = 0;
  for (const node of nodes.values()) {
    proj.set(node.g.position.x, node.g.position.y + 44, node.g.position.z).project(camera);
    placed.push({
      el: node.label,
      x: (proj.x * 0.5 + 0.5) * w,
      y: (-proj.y * 0.5 + 0.5) * h,
      wid: node.label.textContent.length * 6.6,
    });
  }
  // one dogru olanlar yerinde kalsin, arkadakiler cakisirsa yukari kaysin
  placed.sort((a, b) => b.y - a.y);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    for (let guard = 0; guard < 8; guard++) {
      const clash = placed.some((q, j) => j < i
        && Math.abs(q.y - p.y) < 13
        && Math.abs(q.x - p.x) < (q.wid + p.wid) / 2 + 6);
      if (!clash) break;
      p.y -= 13;
    }
    p.el.style.left = p.x.toFixed(1) + 'px';
    p.el.style.top = p.y.toFixed(1) + 'px';
  }
}

const FRAME = 1000 / FPS;
let last = 0, raf = 0;
function tick(now) {
  raf = requestAnimationFrame(tick);
  if (now - last < FRAME) return;
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  // pil dostu: sekme gizliyken ya da kap gorunmezken hicbir sey cizmiyoruz
  if (document.hidden || !root || !root.isConnected || !root.clientWidth || root.hidden) return;

  const s = (Math.sin(now / 900) + 1) / 2;
  steamMats[0].opacity = 0.55 * s;
  steamMats[1].opacity = 0.55 * ((s + 0.33) % 1);
  steamMats[2].opacity = 0.55 * ((s + 0.66) % 1);
  ringMat.opacity = 0.15 + 0.35 * ((Math.sin(now / 320) + 1) / 2);

  if (pong) pongStep(dt);
  catStep(dt);
  for (const node of nodes.values()) advance(node, dt);
  updateLabels();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- disari acilan yuz

function render(list, container, translate) {
  if (translate) T = translate;
  if (!ready || !root || !container.contains(canvas)) {
    init(container);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  for (const n of nodes.values()) n.seen = false;

  const desks = list.filter(atDesk).sort((a, b) => a.pid - b.pid);
  const lounge = list.filter((s) => !atDesk(s)).sort((a, b) => a.pid - b.pid);
  const deskIdx = assignSlots(desks, 'desk');
  const loungeIdx = assignSlots(lounge, 'lounge');

  let maxDesk = 0;
  for (const i of deskIdx.values()) maxDesk = Math.max(maxDesk, i + 1);
  ensureDesks(maxDesk);

  const lit = new Set();
  for (const s of desks) if (stateOf(s) === 'busy') lit.add(deskIdx.get(keyOf(s)));
  for (let i = 0; i < deskScreens.length; i++)
    deskScreens[i].material = lit.has(i) ? editorScreen() : offScreen();

  const touched = [];
  for (const s of desks) {
    const slot = deskSlot(deskIdx.get(keyOf(s)));
    touched.push(stateOf(s) === 'wait'
      ? ensureNode(s, slot.x - 26, slot.z + 8, 0.3, 'none')           // masasinin yaninda, el havada
      : ensureNode(s, slot.x - 2, slot.z + 13, 2.834, 'desk'));       // sandalyesinde, monitore donuk
  }
  for (const s of lounge) {
    const i = loungeIdx.get(keyOf(s));
    const b = LOUNGE[i % LOUNGE.length];
    const ring = Math.floor(i / LOUNGE.length);
    touched.push(ensureNode(s, b.x + ring * 14, b.z + ring * 12, b.rot, b.prop, b.bub));
  }

  for (const [key, n] of nodes) {
    if (n.seen) continue;
    peopleGroup.remove(n.g);
    n.label.remove();
    nodes.delete(key);
    slotOf.delete(key);
  }
  for (const n of touched) applyDest(n);
  hint.textContent = T('camHint');
}

// WebGL yoksa hic ortaya cikmiyoruz: index.html 2D gorunume dusuyor
let supported = false;
try {
  const c = document.createElement('canvas');
  supported = !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
} catch { supported = false; }

if (supported) {
  window.Office3D = { render, onPick: null, onCatPet: null };
  window.dispatchEvent(new Event('office3d-ready'));
}
