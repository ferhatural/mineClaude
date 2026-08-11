/* ccwatch — ofis görünümü (Minecraft/voxel stili)
   busy    -> kendi masasında, işe dalmış
   waiting -> masasının yanında, kameraya dönük, eli havada
   idle    -> lounge'da; kahve içen, ikişerli dedikodu yapanlar                     */
(function () {
  'use strict';

  const W = 1600, H = 860;
  const PX = 3;                  // 1 karakter pikseli = 3 kullanici birimi
  const WALL_X = 1060;           // ofis / lounge ayirici duvar
  const DOOR_TOP = 430, DOOR_BOT = 560;

  // Minecraft yun renkleri
  const SHIRTS = ['#3fa7d6', '#d6603f', '#6fc24f', '#a95fd6', '#e6c33f', '#d64f8a', '#4f5fd6', '#d0d4d9'];
  const SKINS = ['#f0c8a0', '#e0ad82', '#c08a5c', '#98643c', '#f7d9be'];
  const HAIRS = ['#2b2b33', '#4a3728', '#6b4a2f', '#8a8f98', '#c9a24d', '#1f1f24'];
  const PANTS = ['#3b4dbb', '#2f3f9c', '#4a4a6a', '#5a4b7a'];

  function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  const pick = (a, n) => a[n % a.length];
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  // ---------------------------------------------------------------- sprite motoru
  // Satirlardaki her karakter bir piksel; yatay ayni renkler tek <rect>'e birlestirilir.
  function sprite(rows, pal, px, ox, oy) {
    let out = '';
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      let x = 0;
      while (x < row.length) {
        const c = row[x];
        if (c === ' ' || c === '.') { x++; continue; }
        let len = 1;
        while (x + len < row.length && row[x + len] === c) len++;
        const fill = pal[c];
        if (fill) out += `<rect x="${ox + x * px}" y="${oy + y * px}" width="${len * px}" height="${px}" fill="${fill}"/>`;
        x += len;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- karakter

  // govde: 8 genis x 20 yuksek (kafa 8 + govde 12) — bacaklar ayri, cunku yururken oynuyorlar
  const TORSO = [
    'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH',
    'SWESSEWS', 'SSSSSSSS', 'SSSMMSSS', 'SSSSSSSS',
    'TTTTTTTd', 'TTTTTTTd', 'TTTTTTTd', 'TTTTTTTd',
    'TTTTTTTd', 'TTTTTTTd', 'TTTTTTTd', 'TTTTTTTd',
    'TTTTTTTd', 'TTTTTTTd', 'dddddddd', 'dddddddd',
  ];
  // bacak: 4 genis x 12 yuksek
  const LEG_L = ['PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'PPPp', 'BBBb', 'BBBb'];
  const LEG_R = ['pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'pPPq', 'bBBn', 'bBBn'];
  // oturunca bacak uzar (diz + incik onden tek blok gorunur)
  const SIT_L = LEG_L.slice(0, 10).concat(LEG_L.slice(0, 4), LEG_L.slice(10));
  const SIT_R = LEG_R.slice(0, 10).concat(LEG_R.slice(0, 4), LEG_R.slice(10));
  // kol: 4 genis x 12 yuksek (kol + el)
  const ARM = ['TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'SSSk', 'SSSk', 'SSSk'];
  // yukari kalkmis kol: el yukarida
  const ARM_UP = ['SSSk', 'SSSk', 'SSSk', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd', 'TTTd'];
  // kupa: 5x5
  const MUG = ['.WWW.', 'WwwwW', 'WwwwW', 'WwwwW', '.WWW.'];

  function personMarkup(s) {
    const n = hash(s.sessionId || s.pid);
    const shirt = pick(SHIRTS, n), skin = pick(SKINS, n >> 3);
    const hair = pick(HAIRS, n >> 6), pants = pick(PANTS, n >> 9);
    const st = s._st;
    const sitting = s._prop === 'sit';

    const pal = {
      H: hair, S: skin, W: '#ffffff', E: '#2b2b33', M: shade(skin, 0.72),
      T: shirt, d: shade(shirt, 0.82), k: shade(skin, 0.84),
      P: pants, p: shade(pants, 0.86), q: shade(pants, 0.8),
      B: '#46464e', b: '#3a3a41', n: '#33333a',
    };

    const bodyW = 8 * PX;                 // 24
    const torsoX = -bodyW / 2;            // -12
    // oturan kisinin kalcasi koltuk yuksekliginde: govde yukari, bacaklar uzun
    const top = sitting ? -36 * PX : -32 * PX;
    const shoulderY = top + 8 * PX;
    const armW = 4 * PX;                  // 12

    const body = sprite(TORSO, pal, PX, torsoX, top);
    const legY = top + 20 * PX;
    const legs =
      `<g class="leg leg-l">${sprite(sitting ? SIT_L : LEG_L, pal, PX, torsoX, legY)}</g>` +
      `<g class="leg leg-r">${sprite(sitting ? SIT_R : LEG_R, pal, PX, 0, legY)}</g>`;
    const armL = sprite(ARM, pal, PX, 0, 0);
    const armR = sprite(st === 'wait' ? ARM_UP : ARM, pal, PX, 0, 0);

    // kollar omuzdan donsun diye: konum dis <g>'de (attribute), donme ic <g>'de (CSS)
    const leftArm = `<g transform="translate(${torsoX - armW},${shoulderY})">
        <g class="arm arm-l">${armL}</g></g>`;
    const rightArm = st === 'wait'
      ? `<g transform="translate(${torsoX + bodyW},${shoulderY - 12 * PX})">
           <g class="arm arm-up">${armR}</g></g>`
      : `<g transform="translate(${torsoX + bodyW},${shoulderY})">
           <g class="arm arm-r">${armR}</g></g>`;

    const mug = s._prop === 'coffee'
      ? `<g transform="translate(${torsoX - armW - 5 * PX},${shoulderY + 8 * PX})">
           ${sprite(MUG, { W: '#e8e8e8', w: '#6b4326' }, PX, 0, 0)}
           <g class="steam">
             <rect x="${3 * PX}" y="${-4 * PX}" width="${PX}" height="${PX}" fill="#cfd6de"/>
             <rect x="${1 * PX}" y="${-6 * PX}" width="${PX}" height="${PX}" fill="#cfd6de"/>
             <rect x="${3 * PX}" y="${-9 * PX}" width="${PX}" height="${PX}" fill="#cfd6de"/>
           </g>
         </g>`
      : '';

    const bubble = (txt) => {
      const w = txt.length > 1 ? 42 : 30, h = 30;
      const bx = bodyW / 2 + 6, by = top - h - 8;
      return `<g class="bubble">
        <rect x="${bx}" y="${by}" width="${w}" height="${h}" fill="#f2f4f7"/>
        <rect x="${bx + 3}" y="${by + h}" width="${PX * 2}" height="${PX * 2}" fill="#f2f4f7"/>
        <rect x="${bx}" y="${by + h + PX * 2}" width="${PX * 2}" height="${PX * 2}" fill="#f2f4f7"/>
        <text class="of-bub" x="${bx + w / 2}" y="${by + h - 9}">${txt}</text>
      </g>`;
    };

    const ring = st === 'wait'
      ? `<g class="ring">
           <rect x="-30" y="-6" width="60" height="6" fill="none" stroke="var(--wait)" stroke-width="3"/>
         </g>` : '';

    return `
      <rect x="${torsoX - armW}" y="-6" width="${bodyW + armW * 2}" height="6" fill="#000" opacity=".22"/>
      ${ring}
      ${legs}
      <g class="swayer">
        ${leftArm}${body}${rightArm}${mug}
      </g>
      ${st === 'wait' ? bubble('?') : (s._prop === 'gossip' && s._face === 1) ? bubble('···') : ''}
      <text class="of-name${st === 'wait' ? ' wait' : ''}"
            y="${st === 'busy' || st === 'ready' ? 46 : 24}">${escapeText(shortName(s.project))}</text>`;
  }

  function escapeText(t) {
    return String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function shortName(t) {
    t = String(t || '?');
    return t.length > 16 ? t.slice(0, 15) + '…' : t;
  }

  // ---------------------------------------------------------------- sahne parcalari

  const R = (x, y, w, h, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;

  function window16(x, y) {
    let s = R(x - 8, y - 8, 176, 116, 'of-frame2');
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++)
        s += R(x + i * 40, y + j * 50, 36, 46, 'of-glass') +
             R(x + i * 40, y + j * 50, 10, 10, 'of-glass2');
    return s;
  }

  function plant(x, y, s = 1) {
    const b = 14 * s;
    let g = '';
    const leaves = [
      [-2, -5, 4, 2, 1], [-3, -4, 6, 1, 2], [-2, -3, 4, 1, 1],
      [-1, -6, 2, 1, 3], [-3, -2, 6, 1, 2], [-1, -2, 2, 1, 3],
    ];
    for (const [lx, ly, lw, lh, tone] of leaves)
      g += R(x + lx * b, y + ly * b, lw * b, lh * b, 'of-leaf' + tone);
    g += R(x - 1.6 * b, y - b, 3.2 * b, b, 'of-pot');
    g += R(x - 1.2 * b, y, 2.4 * b, 0.5 * b, 'of-pot2');
    return g;
  }

  function deskAt(x, y) {
    // tabla + on yuz + ayaklar + monitor + tuslari tek tek cizilmis klavye
    let s = R(x - 96, y - 60, 192, 14, 'of-deskTop') +
            R(x - 88, y - 46, 176, 40, 'of-deskFront') +
            R(x - 88, y - 6, 12, 6, 'of-deskLeg') + R(x + 76, y - 6, 12, 6, 'of-deskLeg');
    s += R(x + 16, y - 116, 76, 52, 'of-mon') + R(x + 22, y - 110, 64, 40, 'of-screen');
    s += R(x + 22, y - 110, 12, 8, 'of-screen2');
    s += R(x + 44, y - 64, 20, 4, 'of-mon');
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 2; j++)
        s += R(x - 74 + i * 9, y - 72 + j * 7, 6, 5, 'of-key');
    return s;
  }

  // arayuz metinleri disaridan gelir (index.html'deki sozluk); veri asla cevrilmez
  let T = (k) => k;
  let curLang = null;

  const buildScene = () => `
    <defs>
      <pattern id="of-floorPat" width="80" height="80" patternUnits="userSpaceOnUse">
        <rect width="80" height="80" class="of-floorA"/>
        <rect width="40" height="40" class="of-floorB"/>
        <rect x="40" y="40" width="40" height="40" class="of-floorB"/>
      </pattern>
      <pattern id="of-wallPat" width="80" height="40" patternUnits="userSpaceOnUse">
        <rect width="80" height="40" class="of-wallA"/>
        <rect x="1" y="1" width="38" height="18" class="of-wallB"/>
        <rect x="41" y="1" width="38" height="18" class="of-wallB"/>
        <rect x="21" y="21" width="38" height="18" class="of-wallB"/>
        <rect x="-19" y="21" width="38" height="18" class="of-wallB"/>
        <rect x="61" y="21" width="38" height="18" class="of-wallB"/>
      </pattern>
      <pattern id="of-rugPat" width="60" height="60" patternUnits="userSpaceOnUse">
        <rect width="60" height="60" class="of-rugA"/>
        <rect width="30" height="30" class="of-rugB"/>
        <rect x="30" y="30" width="30" height="30" class="of-rugB"/>
      </pattern>
    </defs>

    <rect x="0" y="0" width="${W}" height="200" fill="url(#of-wallPat)"/>
    <rect x="0" y="200" width="${W}" height="${H - 200}" fill="url(#of-floorPat)"/>
    ${R(0, 190, W, 10, 'of-skirt')}

    ${window16(140, 44)}
    ${window16(440, 44)}
    ${window16(1300, 44)}

    <!-- beyaz tahta -->
    ${R(770, 40, 200, 120, 'of-boardEdge')}
    ${R(780, 50, 180, 100, 'of-board')}
    ${R(796, 74, 100, 8, 'of-boardInk')}
    ${R(796, 96, 148, 8, 'of-boardInk')}
    ${R(796, 118, 64, 8, 'of-boardInk')}

    <!-- ayirici duvar + kapi boslugu -->
    ${R(WALL_X, 200, 16, DOOR_TOP - 200, 'of-skirt')}
    ${R(WALL_X, DOOR_BOT, 16, H - DOOR_BOT, 'of-skirt')}

    <text class="of-label" x="60" y="246">${T('desks')}</text>
    <text class="of-label" x="${WALL_X + 150}" y="246">${T('lounge')}</text>

    <!-- lounge -->
    <rect x="1168" y="512" width="330" height="220" fill="url(#of-rugPat)"/>
    ${R(1150, 640, 260, 40, 'of-sofa')}
    ${R(1150, 600, 260, 40, 'of-sofa2')}
    ${R(1134, 604, 20, 76, 'of-sofa2')}
    ${R(1406, 604, 20, 76, 'of-sofa2')}
    ${R(1452, 636, 120, 16, 'of-deskTop')}
    ${R(1462, 652, 12, 44, 'of-deskLeg')}
    ${R(1550, 652, 12, 44, 'of-deskLeg')}
    ${R(1494, 620, 16, 16, 'of-mug')}

    <!-- kahve makinesi -->
    ${R(1108, 236, 80, 124, 'of-machine')}
    ${R(1118, 250, 60, 34, 'of-screen')}
    ${R(1126, 300, 44, 30, 'of-machine2')}
    ${R(1140, 312, 16, 14, 'of-mug')}
    ${R(1170, 292, 8, 8, 'of-lamp')}

    ${plant(1556, 250, .85)}
    ${plant(1092, 460, .8)}
    ${plant(52, 350, .9)}
    ${plant(1004, 800, .8)}
  `;

  // ---------------------------------------------------------------- yerlesim

  // once kanepe ve halinin ustundeki dedikodu kosesi dolsun, sonra kahve makinesi
  const LOUNGE = [
    { x: 1218, y: 690, prop: 'sit', face: 1 },      // kanepede oturan
    { x: 1336, y: 690, prop: 'sit', face: -1 },     // kanepede oturan
    { x: 1205, y: 548, prop: 'gossip', face: 1 },
    { x: 1318, y: 556, prop: 'gossip', face: -1 },
    { x: 1252, y: 352, prop: 'coffee', face: 1 },
    { x: 1362, y: 376, prop: 'coffee', face: -1 },
    { x: 1470, y: 312, prop: 'none', face: 1 },
    { x: 1492, y: 578, prop: 'coffee', face: -1 },
    { x: 1240, y: 812, prop: 'gossip', face: 1 },
    { x: 1352, y: 818, prop: 'gossip', face: -1 },
    { x: 1556, y: 712, prop: 'coffee', face: -1 },
    { x: 1142, y: 424, prop: 'none', face: 1 },
  ];

  const DESK_X = [250, 560, 870];
  const DESK_Y = [386, 596, 806];
  const deskSlot = (i) => ({ x: DESK_X[i % 3], y: DESK_Y[Math.floor(i / 3) % 3] + Math.floor(i / 9) * 14 });

  function desksMarkup(count) {
    let s = '';
    for (let i = 0; i < count; i++) {
      const { x, y } = deskSlot(i);
      s += deskAt(x, y);
    }
    return s;
  }

  // ---------------------------------------------------------------- render

  let root = null, peopleLayer = null, deskLayer = null, deskCount = 0;
  const nodes = new Map();

  function init(container) {
    container.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"
            role="img" aria-label="${T('appTitle')}">
         <g id="of-scene">${buildScene()}</g>
         <g id="of-people"></g>
         <g id="of-desks"></g>
       </svg>`;
    root = container.querySelector('svg');
    peopleLayer = root.querySelector('#of-people');
    deskLayer = root.querySelector('#of-desks');
    deskCount = 0;
    nodes.clear();
  }

  function ensureDesks(n) {
    const want = Math.max(9, Math.ceil(n / 3) * 3);
    if (want === deskCount) return;
    deskLayer.innerHTML = desksMarkup(want);
    deskCount = want;
  }

  // busy/wait/ready masada oturur; yalnizca sogumus (cold) olanlar lounge'a iner
  // s.asked: Claude turu bitirirken soru sormus. Session dosyasinda "idle" yaziyor
  // ama klavye sende — kart tarafiyla ayni sayilsin, eli o da kaldirsin.
  const stateOf = (s) =>
    s.status === 'busy' ? 'busy'
      : s.status === 'waiting' ? 'wait'
      : (s.status === 'idle' && !s.cold) ? (s.asked ? 'wait' : 'ready') : 'idle';
  const atDesk = (s) => stateOf(s) !== 'idle';

  const SPEED = 300;                                     // birim / saniye (yuruyus hizi)
  const DOOR = { x: WALL_X + 4, y: (DOOR_TOP + DOOR_BOT) / 2 };
  const scaleAt = (y) => (0.8 + (y / H) * 0.3).toFixed(3);
  const place = (n, p) => { n.g.style.transform = `translate(${p.x}px,${p.y}px) scale(${scaleAt(p.y)})`; };

  // Kisiyi hedefe yurutur. Ofis <-> lounge geciyorsa once kapiya ugrar,
  // yoksa duvarin icinden gecmis gibi gorunuyor.
  function walkTo(node, dest) {
    const path = [];
    if ((node.at.x < WALL_X) !== (dest.x < WALL_X)) path.push(DOOR);
    path.push(dest);

    clearTimeout(node.timer);
    node.moving = true;
    node.g.classList.add('walking');

    let i = 0;
    const step = () => {
      if (i >= path.length) {
        node.moving = false;
        node.g.classList.remove('walking');
        node.g.style.transitionDuration = '';
        return;
      }
      const p = path[i++];
      const dist = Math.hypot(p.x - node.at.x, p.y - node.at.y);
      const ms = Math.max(320, Math.min(3200, (dist / SPEED) * 1000));
      node.g.style.transitionDuration = ms + 'ms';
      place(node, p);
      node.at = p;
      node.timer = setTimeout(step, ms + 20);
    };
    step();
  }

  // 1. asama: dugumu olustur/guncelle (konuma dokunmadan)
  function ensureNode(s, x, y, face, prop) {
    const key = String(s.sessionId || s.pid);
    const st = stateOf(s);
    s._prop = prop;
    s._face = face;
    s._st = st;

    let node = nodes.get(key);
    if (!node) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'person');
      g.style.cursor = 'pointer';
      g.addEventListener('click', (e) => {
        if (window.Office.onPick) window.Office.onPick(key, e.clientX, e.clientY);
      });
      peopleLayer.appendChild(g);
      node = { g, sig: '', at: { x, y }, fresh: true };
      nodes.set(key, node);
    }

    const sig = [st, prop, face, s.project].join('|');
    if (node.sig !== sig) {
      node.g.setAttribute('class', `person p-${st}${node.moving ? ' walking' : ''}`);
      node.g.innerHTML = `<g transform="scale(${face},1)">${personMarkup(s)}</g>`;
      const label = node.g.querySelector('.of-name');
      if (label && face === -1) label.setAttribute('transform', 'scale(-1,1)');
      node.sig = sig;
    }
    node.g.dataset.y = y;                 // derinlik anahtari: hedef y (yururken sabit kalir)

    // proje adi ve Claude Code'un kendi metni cevrilmez, yalnizca durum etiketi cevrilir
    const dispKey = st === 'wait' ? 'waiting' : st;
    const t = `${s.project} — ${T(dispKey)}${s.waitingFor ? ' (' + s.waitingFor + ')' : ''}`;
    let title = node.g.querySelector('title');
    if (!title) {
      title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      node.g.appendChild(title);
    }
    title.textContent = t;
    node.seen = true;
    node.dest = { x, y };
    return node;
  }

  // 2. asama: derinlik sirasi. DOM'da dugum tasimak calisan CSS gecisini iptal ettigi icin
  // sadece sira gercekten degistiyse yeniden diziyoruz — ve hep hareketten ONCE.
  function reorder() {
    const cur = [...peopleLayer.children];
    const want = cur.slice().sort((a, b) => (+a.dataset.y || 0) - (+b.dataset.y || 0));
    if (cur.length === want.length && cur.every((el, i) => el === want[i])) return;
    for (const el of want) peopleLayer.appendChild(el);
  }

  // 3. asama: konumu uygula (ilk kez ise yerine koy, degistiyse yurut)
  function applyPos(node) {
    const d = node.dest;
    if (node.fresh) {
      node.fresh = false;
      node.at = d;
      place(node, d);
      return;
    }
    const cur = node.moving ? node.goal : node.at;
    if (cur && cur.x === d.x && cur.y === d.y) return;   // zaten oraya gidiyor
    node.goal = d;
    walkTo(node, d);
  }

  // Slotlar kisiye yapisir: biri lounge'dan ayrilinca kalanlar yerinden oynamasin diye
  // once herkes eski slotunu korur, bosa dusenler en kucuk bos slotu alir.
  const slotOf = new Map();
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

  function render(list, container, translate, langCode) {
    if (translate) T = translate;
    // dil degistiyse sahneyi (MASALAR / DESKS gibi etiketleri) bastan kur
    if (!root || !container.contains(root) || langCode !== curLang) {
      init(container);
      curLang = langCode;
    }
    for (const n of nodes.values()) n.seen = false;

    const desks = list.filter(atDesk);
    const lounge = list.filter((s) => !atDesk(s));
    desks.sort((a, b) => a.pid - b.pid);
    lounge.sort((a, b) => a.pid - b.pid);

    const deskIdx = assignSlots(desks, 'desk');
    const loungeIdx = assignSlots(lounge, 'lounge');

    let maxDesk = 0;
    for (const i of deskIdx.values()) maxDesk = Math.max(maxDesk, i + 1);
    ensureDesks(maxDesk);

    const touched = [];
    for (const s of desks) {
      const slot = deskSlot(deskIdx.get(keyOf(s)));
      touched.push(stateOf(s) === 'wait'
        ? ensureNode(s, slot.x - 156, slot.y + 12, 1, 'none')   // masasinin yaninda, eli havada
        : ensureNode(s, slot.x - 30, slot.y - 22, 1, 'none'));  // masasinin arkasinda
    }
    for (const s of lounge) {
      const i = loungeIdx.get(keyOf(s));
      const b = LOUNGE[i % LOUNGE.length];
      const ring = Math.floor(i / LOUNGE.length);
      touched.push(ensureNode(s, b.x + ring * 26, b.y + ring * 18, b.face, b.prop));
    }

    for (const [key, n] of nodes) {
      if (!n.seen) { clearTimeout(n.timer); n.g.remove(); nodes.delete(key); slotOf.delete(key); }
    }
    reorder();
    for (const n of touched) applyPos(n);
  }

  window.Office = { render, onPick: null };
})();
