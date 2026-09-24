/* mineClaude — gomulu terminaller.
   Her sekme bir PTY; PTY'ler ana surecte, burasi sadece cizim ve klavye.
   xterm.js vendor'da (three.js gibi), node-pty istege bagli: yoksa bu gorunum
   hic listelenmiyor. */

import { Terminal } from './vendor/xterm.module.js';
import { FitAddon } from './vendor/xterm-addon-fit.module.js';
import { SearchAddon } from './vendor/xterm-addon-search.module.js';

// Karttaki filtre renkleriyle ayni dil (bkz. index.html .count.waiting/.busy/.ready/.idle):
// calisiyor=yesil, input bekliyor=sari, bekliyor=mavi, bosta/bilinmiyor=gri.
function statusColor(status) {
  if (status === 'waiting') return 'var(--wait)';
  if (status === 'busy') return 'var(--busy)';
  if (status === 'ready') return 'var(--idle)';
  if (status === 'idle' || status === 'unknown') return 'var(--ended)';
  return 'var(--line)';
}

// Iki tasima, tek arayuz. Electron'da PTY'ler ana surecte ve IPC ile konusuluyor;
// tarayicida ayni PTY'ler sunucunun icinde ve WebSocket ile. term.js ikisini de
// ayni sekilli nesne olarak goruyor, geri kalan kod farki bilmiyor.
function electronTransport(t) {
  return { ...t, kind: 'electron', available: () => t.available().then((r) => !!(r && r.ok)) };
}

function webTransport() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws = null, nextRef = 1;
  const waiting = new Map();          // ref -> resolve
  const dataFns = [], exitFns = [];

  const openFns = [];
  let connecting = null;
  let tries = 0;

  const connect = () => {
    if (ws && ws.readyState === 1) return Promise.resolve(ws);
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      ws = new WebSocket(`${proto}://${location.host}/terminals`);
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'created' || m.t === 'attached' || m.t === 'error') {
          const w = waiting.get(m.ref);
          if (w) { waiting.delete(m.ref); m.t === 'error' ? w.reject(new Error(m.error)) : w.resolve(m); }
        } else if (m.t === 'data') for (const f of dataFns) f({ id: m.id, data: m.data });
        else if (m.t === 'exit') for (const f of exitFns) f({ id: m.id, code: m.code });
        else if (m.t === 'gone') for (const f of exitFns) f({ id: m.id, code: null, gone: true });
      };
      ws.onopen = () => { connecting = null; tries++; resolve(ws); for (const f of openFns) f(); };
      ws.onerror = () => { connecting = null; reject(new Error('terminal baglantisi kurulamadi')); };
      // Tunel dusunce, tablet uyuyunca, ag degisince: PTY'ler sunucuda yasiyor,
      // tek yapmamiz gereken geri baglanip sekmeleri yeniden eslestirmek.
      ws.onclose = () => { connecting = null; setTimeout(() => connect().catch(() => {}), 1500); };
    });
    return connecting;
  };

  const send = (m) => connect().then((s) => s.send(JSON.stringify(m)));

  return {
    kind: 'web',
    available: () => fetch('/api/terminals').then((r) => r.json()).then((d) => !!d.enabled).catch(() => false),
    create: (opt) => new Promise((resolve, reject) => {
      const ref = nextRef++;
      waiting.set(ref, { resolve, reject });
      send({ t: 'create', ref, ...opt }).catch(reject);
      setTimeout(() => { if (waiting.delete(ref)) reject(new Error('sunucu yanit vermedi')); }, 15000);
    }),
    write: (id, data) => send({ t: 'write', id, data }),
    resize: (id, cols, rows) => send({ t: 'resize', id, cols, rows }),
    kill: (id) => send({ t: 'kill', id }),
    pickFolder: null,                 // tarayicida yerel klasor secici yok
    onData: (fn) => dataFns.push(fn),
    onExit: (fn) => exitFns.push(fn),
    onReconnect: (fn) => openFns.push(fn),
    state: () => ({ ready: ws ? ws.readyState : -1, tries }),
    kind: 'web',
    reattach: (id) => new Promise((resolve, reject) => {
      const ref = nextRef++;
      waiting.set(ref, { resolve, reject });
      send({ t: 'attach', ref, id }).catch(reject);
      setTimeout(() => { if (waiting.delete(ref)) reject(new Error('yanit yok')); }, 8000);
    }),
  };
}

const D = window.mineClaudeDesktop;
const T = D && D.term ? electronTransport(D.term) : webTransport();

T.available().then((ok) => { if (ok) start(); }).catch(() => {});

const GLOBE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.8 2.6 3.9 2.6 6.2S9.8 12.4 8 14.2C6.2 12.4 5.4 10.3 5.4 8S6.2 3.6 8 1.8z"/></svg>';
const ico = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  back: ico('<path d="M10 3L5 8l5 5"/>'),
  fwd: ico('<path d="M6 3l5 5-5 5"/>'),
  reload: ico('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.8h-2.8"/>'),
  pin: ico('<path d="M9.8 1.8l4.4 4.4-2 .6-2.4 2.4.2 3-1.4 1.4-2.6-2.6L2.6 14.4M5.2 8.2L2.6 5.6 4 4.2l3 .2 2.4-2.4z"/>'),
  stop: ico('<path d="M4 4l8 8M12 4l-8 8"/>'),
  external: ico('<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
};

function start() {
  const tabs = [];              // { id, cwd, title, term, fit, el, dead }
  let active = null;
  let host = null, strip = null, panes = null;
  let T2 = (k) => k;
  // 'tabs': tek terminal tam ekran · 'tiles': hepsi ayni anda, izgara
  let layout = localStorage.getItem('cc.termLayout') === 'tiles' ? 'tiles' : 'tabs';
  // Gorev paneli mineClaude'un kendi tarafinda aciliyor/kapaniyor; burasi
  // sadece anahtar dugmeyi cizip acik/kapali oldugunu isaretliyor.
  let tasksOpen = false;

  // Kapanista acik olan sekmeler. Uygulama PTY'leri surecinde tuttugu icin cikista
  // hepsi oluyor; burada ne oldugunu hatirlayip acilista geri yuklemeyi *oneriyoruz*.
  // Kendiliginden acmiyoruz: bes sekme, bes Claude oturumu demek.
  const FONT_KEY = 'cc.termFont';
  let fontSize = Math.min(22, Math.max(9, parseFloat(localStorage.getItem(FONT_KEY)) || 12.5));

  const RESTORE_KEY = 'cc.termRestore';
  // Tarayici sekmeleri geri yuklenmiyor: terminaller geri gelince projelerin
  // siteleri zaten kendiliginden aciliyor (openProjectWeb). Eski surumun kaydi:
  try { localStorage.removeItem('cc.termWeb'); } catch { /* */ }
  let webSeq = 0;
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(RESTORE_KEY) || '[]'); } catch { pending = []; }
  if (!Array.isArray(pending)) pending = [];

  function saveRestore() {
    const snap = tabs.filter((t) => !t.dead && !t.web && !t.devTab).map((t) => ({ cwd: t.cwd, title: t.title, sessionId: t.sessionId || null }));
    try { localStorage.setItem(RESTORE_KEY, JSON.stringify(snap)); } catch { /* dolu olabilir */ }
  }

  // xterm'in 16 rengi (ve varsayilanlari) koyu zemin icin secilmis. Acik temada
  // ayni degerler krem uzerinde okunmuyor — ozellikle sari, cyan ve mor. O yuzden
  // renkler CSS'te yasiyor (bkz. index.html :root) ve tema degisince buradan
  // yeniden okunuyor. Koyu temada palet hic gonderilmiyor: xterm'in kendi
  // varsayilanlari zaten dogru, dokunmak gorunumu bosuna degistirirdi.
  const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

  const cssVar = (n, d) => (getComputedStyle(document.body).getPropertyValue(n) || d).trim();

  const theme = () => {
    const cs = getComputedStyle(document.body);
    const v = (n, d) => (cs.getPropertyValue(n) || d).trim();
    const t = {
      background: v('--term-bg', '#16191e'),
      foreground: v('--term-fg', '#e7eaef'),
      cursor: v('--idle', '#5b9cf0'),
      selectionBackground: v('--term-sel', 'rgba(91,156,240,.30)'),
    };
    if (v('--term-light', '')) ANSI.forEach((ad, i) => { t[ad] = v('--t' + i, ''); });
    return t;
  };

  // Claude Code renklerini 24-bit basiyor (pty.js COLORTERM=truecolor), yani
  // paletle ezilemiyorlar: koyu tema icin secilmis soluk mor/mavi vurgular krem
  // zeminde okunmuyor. xterm bu oranin altinda kalan her on plan rengini zemine
  // gore koyulastiriyor — acik temayi okunur yapan sey bu. Koyu temada 1 (kapali).
  const minContrast = () => parseFloat(cssVar('--term-min-contrast', '1')) || 1;

  function mount(container, translate) {
    if (translate) T2 = translate;
    if (host && host.isConnected) { fitAll(); return; }
    container.innerHTML = '';
    host = document.createElement('div');
    host.className = 'tm-host';
    strip = document.createElement('div');
    strip.className = 'tm-strip';
    panes = document.createElement('div');
    panes.className = 'tm-panes';
    host.append(strip, panes);
    container.appendChild(host);
    drawStrip();
    applyLayout();
    if (!tabs.length) showEmpty();
  }

  function showEmpty() {
    const teklif = pending.length
      ? `<div class="tm-restore">
           <span>${T2('termRestoreAsk', pending.length)}</span>
           <button class="tm-yes">${T2('termRestoreYes')}</button>
           <button class="tm-no">${T2('termRestoreNo')}</button>
           <div class="tm-restore-list">${pending.map((r) => esc(r.title)).join(' · ')}</div>
         </div>`
      : '';
    panes.innerHTML = `<div class="tm-empty">
      ${teklif}
      <div>${T2('termEmpty')}</div>
      <button class="tm-open">${T2('termNew')}</button>
    </div>`;
    panes.querySelector('.tm-open').onclick = () => openPicked();
    const yes = panes.querySelector('.tm-yes');
    if (yes) {
      yes.onclick = () => restoreAll();
      panes.querySelector('.tm-no').onclick = () => { pending = []; saveRestore(); showEmpty(); };
    }
  }

  async function restoreAll() {
    const list = pending;
    pending = [];
    for (const r of list) {
      // Oturum kimligi biliniyorsa dogrudan ona don. `claude --resume` argumansiz
      // calisirsa secim ekrani aciyor, otomatik geri yuklemede istedigimiz o degil.
      // Oturum bulunamazsa (hic konusulmamis, silinmis, sikistirilmis) resume
      // sifirdan farkli donuyor: o zaman ayni klasorde taze bir claude aciliyor.
      // Boylece sekme her hâlukârda calisir bir Claude'la geliyor, hata satiri
      // ve bos kabukla degil. Fallback mantigi burada bir shell string olarak
      // kurulmuyor artik: POSIX ve Windows'ta sozdizimi farkli (`||` PowerShell
      // 5.1'de yok), o karari resumeSessionId ile pty.js platforma gore veriyor.
      await open(r.cwd, undefined, r.sessionId || undefined);
    }
    saveRestore();
  }

  // --- sekmeleri elle siralama (surukle-birak) ---
  // Proje sitesi / dev sunucusu sekmeleri kendiliginden terminalin yanina geliyor;
  // yerini begenmeyen tasiyabilsin. Yalniz tabs dizisinin sirasi degisiyor:
  // pane'leri DOM'da tasimiyoruz, cunku <webview> DOM'da yer degistirince sayfa
  // bastan yukleniyor. Izgaradaki sira CSS order ile (bkz. applyLayout).
  let drag = null;                 // { t } surukleme surerken
  let redrawLater = false;         // surukleme sirasinda gelen drawStrip istekleri

  function moveTab(t, to) {
    const from = tabs.indexOf(t);
    if (from < 0) return;
    tabs.splice(from, 1);
    tabs.splice(to > from ? to - 1 : to, 0, t);
    saveRestore();
    applyLayout();
    drawStrip();
  }

  function wireDrag(b, t) {
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      drag = { t };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.title || '');
      b.classList.add('dragging');
    });
    b.addEventListener('dragend', () => {
      drag = null;
      b.classList.remove('dragging');
      strip.querySelectorAll('.drop-l,.drop-r').forEach((x) => x.classList.remove('drop-l', 'drop-r'));
      if (redrawLater) { redrawLater = false; drawStrip(); }
    });
    // Imlec sekmenin sol yarisindaysa oncesine, sag yarisindaysa sonrasina
    const side = (e) => { const r = b.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 ? 'l' : 'r'; };
    b.addEventListener('dragover', (e) => {
      if (!drag || drag.t === t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const s = side(e);
      b.classList.toggle('drop-l', s === 'l');
      b.classList.toggle('drop-r', s === 'r');
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-l', 'drop-r'));
    b.addEventListener('drop', (e) => {
      if (!drag || drag.t === t) return;
      e.preventDefault();
      const moving = drag.t;
      const at = tabs.indexOf(t) + (side(e) === 'r' ? 1 : 0);
      drag = null;
      redrawLater = false;
      moveTab(moving, at);
    });
  }

  function drawStrip() {
    if (drag) { redrawLater = true; return; }
    strip.innerHTML = '';
    for (const w of tabs) if (w.web && w.pinBtn) {
      const p = projectOf(w);
      const dev = isLocal(w.url);
      const on = !!(p && w.url && (dev ? p.devUrl === w.url : (p.site && sameSite(p.site, w.url))));
      w.pinBtn.hidden = !p || !/^https?:/i.test(w.url || '');
      w.pinBtn.classList.toggle('on', on);
      if (p) w.pinBtn.title = T2(dev ? (on ? 'webPinnedDev' : 'webPinDev') : (on ? 'webPinned' : 'webPin'), baseName(p.cwd));
    }
    for (const t of tabs) {
      const b = document.createElement('button');
      b.className = 'tm-tab' + (t === active ? ' on' : '') + (t.dead ? ' dead' : '') + (t.loading ? ' loading' : '')
        + (t.waiting ? ' waiting' : '') + (t.lounge && !t.waiting && !t.dead ? ' lounge' : '');
      b.title = t.web ? (t.url || T2('webTab')) : t.cwd;
      b.style.setProperty('--c', statusColor(t.status));
      if (t.el) t.el.style.setProperty('--c', statusColor(t.status)); // izgara kipinde etkin cercevenin rengi
      const ic = !t.web ? '' : (t.icon && !t.loading ? `<img class="tm-globe" src="${esc(t.icon)}" alt="">` : GLOBE.replace('<svg', '<svg class="tm-globe"'));
      b.innerHTML = ic + `<span class="tm-tab-title">${esc(t.title)}</span>`;
      b.onclick = () => select(t);
      wireDrag(b, t);
      const x = document.createElement('span');
      x.className = 'tm-x';
      x.textContent = '×';
      x.onclick = (e) => { e.stopPropagation(); close(t); };
      b.appendChild(x);
      strip.appendChild(b);
    }
    const plus = document.createElement('button');
    plus.className = 'tm-plus';
    plus.textContent = '+';
    plus.title = T2('termNew') + '  (⌘T)';
    plus.onclick = () => openPicked();
    strip.appendChild(plus);

    const web = document.createElement('button');
    web.className = 'tm-lay';
    web.title = T2('webNew');
    web.innerHTML = GLOBE;
    web.onclick = () => openWeb('');
    strip.appendChild(web);

    // Tablette ⌘F yok; ayni is icin bir dugme.
    const fnd = document.createElement('button');
    fnd.className = 'tm-lay tm-findbtn' + (find && !find.box.hidden ? ' on' : '');
    fnd.title = T2('termFind') + '  (⌘F)';
    fnd.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>';
    fnd.onclick = () => (find && !find.box.hidden ? closeFind() : openFind());
    fnd.style.marginLeft = '0';      // sag grubu 🌐 basliyor (margin-left:auto onda)
    strip.appendChild(fnd);

    const tasksBtn = document.createElement('button');
    tasksBtn.className = 'tm-tasks-btn' + (tasksOpen ? ' on' : '');
    tasksBtn.title = T2('tasksTab');
    tasksBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">'
      + '<rect x="1.8" y="2.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 4h7.4"/>'
      + '<rect x="1.8" y="6.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 8h7.4"/>'
      + '<rect x="1.8" y="10.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 12h7.4"/></svg>';
    tasksBtn.onclick = () => window.dispatchEvent(new Event('term-tasks-toggle'));
    strip.appendChild(tasksBtn);

    const lay = document.createElement('button');
    lay.className = 'tm-lay';
    lay.title = layout === 'tabs' ? T2('termTiles') : T2('termTabs');
    lay.innerHTML = layout === 'tabs'
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="9" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="1.8" y="9" width="5.2" height="5.2" rx="1"/><rect x="9" y="9" width="5.2" height="5.2" rx="1"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4"/><path d="M1.8 6.2h12.4"/></svg>';
    lay.onclick = () => setLayout(layout === 'tabs' ? 'tiles' : 'tabs');
    lay.style.marginLeft = '0';
    strip.appendChild(lay);
  }

  // --- tampon icinde arama (⌘F) ---
  // Tek cubuk, etkin sekmede arar. Sekme degisince eski sekmenin isaretleri
  // siliniyor, ayni metin yeni sekmede aranıyor. Enter ileri, ⇧Enter geri,
  // Esc kapatip terminale doner. Vurgular xterm'in decoration API'siyle:
  // allowProposedApi acik oldugu icin calisiyor.
  let find = null;                 // { box, input, count, caseBtn, caseSensitive }

  const findDecor = () => ({
    matchBackground: 'rgba(255,196,0,.35)',
    matchBorder: 'rgba(255,196,0,.9)',
    matchOverviewRuler: '#e0a800',
    activeMatchBackground: 'rgba(255,140,0,.75)',
    activeMatchBorder: '#ff8c00',
    activeMatchColorOverviewRuler: '#ff8c00',
  });

  function buildFind() {
    const box = document.createElement('div');
    box.className = 'tm-find';
    box.hidden = true;
    box.innerHTML = `
      <input type="text" spellcheck="false" autocomplete="off" placeholder="${esc(T2('termFind'))}">
      <span class="tm-find-count"></span>
      <button class="tm-find-case" title="${esc(T2('termFindCase'))}">Aa</button>
      <button class="tm-find-prev" title="⇧Enter">↑</button>
      <button class="tm-find-next" title="Enter">↓</button>
      <button class="tm-find-x" title="Esc">×</button>`;
    const input = box.querySelector('input');
    const count = box.querySelector('.tm-find-count');
    const caseBtn = box.querySelector('.tm-find-case');
    find = { box, input, count, caseBtn, caseSensitive: localStorage.getItem('cc.termFindCase') === '1' };
    caseBtn.classList.toggle('on', find.caseSensitive);

    input.oninput = () => runFind('incremental');
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? 'prev' : 'next'); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
      else if (e.metaKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); runFind(e.shiftKey ? 'prev' : 'next'); }
      // Cubuk acikken ⌘F yeniden basilirsa: metni sec, yeniden yaz
      else if (e.metaKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); input.select(); }
    };
    caseBtn.onclick = () => {
      find.caseSensitive = !find.caseSensitive;
      localStorage.setItem('cc.termFindCase', find.caseSensitive ? '1' : '0');
      caseBtn.classList.toggle('on', find.caseSensitive);
      // addon-search 0.16: findNext yeni secenekleri once "son secenek" diye
      // yaziyor, sonra degisti mi diye kendisiyle karsilastiriyor; secenek
      // degisince vurgular hic yenilenmiyor. Temizleyip onbellegini dusuruyoruz.
      if (active && active.search) active.search.clearDecorations();
      runFind('incremental');
      input.focus();
    };
    box.querySelector('.tm-find-prev').onclick = () => { runFind('prev'); input.focus(); };
    box.querySelector('.tm-find-next').onclick = () => { runFind('next'); input.focus(); };
    box.querySelector('.tm-find-x').onclick = () => closeFind();
    // Tiklama terminale gitmesin (mousedown -> select(t) -> term.focus())
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    return box;
  }

  function openFind() {
    if (!host || !active || active.web) return false;
    if (!find) host.appendChild(buildFind());
    const wasHidden = find.box.hidden;
    find.box.hidden = false;
    // Terminalde secili metin varsa onu ara: Terminal.app ve VS Code boyle yapiyor.
    const sel = active.term.getSelection();
    if (sel && !sel.includes('\n')) find.input.value = sel.trim();
    find.input.focus();
    find.input.select();
    if (wasHidden) drawStrip();
    if (find.input.value) runFind('incremental');
    return true;
  }

  function closeFind() {
    if (!find || find.box.hidden) return false;
    find.box.hidden = true;
    for (const t of tabs) if (t.search) t.search.clearDecorations();
    showCount(null);
    drawStrip();
    if (active) focusTab(active);
    return true;
  }

  function runFind(how) {
    if (!find || !active || !active.search) return;
    const q = find.input.value;
    const opts = { caseSensitive: find.caseSensitive, decorations: findDecor() };
    if (!q) { active.search.clearDecorations(); showCount(null); return; }
    // incremental: yazarken imlec olduğu eslesmede kalsin, ileri ziplamasin
    if (how === 'prev') active.search.findPrevious(q, opts);
    else active.search.findNext(q, { ...opts, incremental: how === 'incremental' });
  }

  function showCount(r) {
    if (!find) return;
    if (!r) { find.count.textContent = ''; find.box.classList.remove('none'); return; }
    // resultIndex -1: eslesme var ama etkin olan yok (bkz. addon); resultCount -1: 1000+ eslesme
    const total = r.resultCount < 0 ? '1000+' : String(r.resultCount);
    find.count.textContent = r.resultCount === 0 ? T2('termFindNone')
      : `${r.resultIndex >= 0 ? r.resultIndex + 1 : '–'}/${total}`;
    find.box.classList.toggle('none', r.resultCount === 0);
  }

  // Sekme degisince aramayi yeni sekmeye tasi
  function refind(prev) {
    if (!find || find.box.hidden) return;
    if (prev && prev.search) prev.search.clearDecorations();
    showCount(null);
    if (find.input.value) runFind('incremental');
  }

  function setLayout(next) {
    layout = next;
    localStorage.setItem('cc.termLayout', layout);
    applyLayout();
    drawStrip();
  }

  // Izgarada kolon sayisi: kareye yakin bir duzen. 3 terminal -> 2x2'nin ucu dolu.
  // --- izgarada boyutlandirma ---
  // Kolon/satir sinirlarinda suruklenebilir ayraclar. Oranlar fr cinsinden ve
  // izgaranin sekline gore ayri saklaniyor ("2x1", "2x2"...): iki terminalde
  // ayarladigin bolme, ucuncusu acilinca bozulmasin; geri donunce yine gelsin.
  // Cift tik: esitle. Terminaller boyutu ResizeObserver'la kendileri aliyor.
  const SIZES_KEY = 'cc.termTileSizes';
  let tileSizes = {};
  try { tileSizes = JSON.parse(localStorage.getItem(SIZES_KEY) || '{}') || {}; } catch { tileSizes = {}; }
  let grid = { cols: 1, rows: 1, c: [1], r: [1] };
  const GAP = 6, PAD = 6, MIN_PX = 90;

  const okFr = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => x > 0 && isFinite(x));
  function sizesFor(cols, rows) {
    const s = tileSizes[cols + 'x' + rows] || {};
    return { c: okFr(s.c, cols) ? s.c.slice() : Array(cols).fill(1), r: okFr(s.r, rows) ? s.r.slice() : Array(rows).fill(1) };
  }
  function saveSizes() {
    tileSizes[grid.cols + 'x' + grid.rows] = { c: grid.c, r: grid.r };
    try { localStorage.setItem(SIZES_KEY, JSON.stringify(tileSizes)); } catch { /* dolu */ }
  }
  const tpl = (a) => a.map((f) => `minmax(0,${+f.toFixed(4)}fr)`).join(' ');

  // Ayraclarin yeri fr'lerden hesaplaniyor: izgaranin kendi olcusunu okumaya gerek yok.
  function placeGutters() {
    if (!panes) return;
    const W = panes.clientWidth - 2 * PAD - (grid.cols - 1) * GAP;
    const H = panes.clientHeight - 2 * PAD - (grid.rows - 1) * GAP;
    const sc = grid.c.reduce((a, b) => a + b, 0), sr = grid.r.reduce((a, b) => a + b, 0);
    let acc = 0;
    panes.querySelectorAll('.tm-gut.v').forEach((g, i) => {
      acc += grid.c[i];
      g.style.left = (PAD + (acc / sc) * W + i * GAP + GAP / 2) + 'px';
    });
    acc = 0;
    panes.querySelectorAll('.tm-gut.h').forEach((g, i) => {
      acc += grid.r[i];
      g.style.top = (PAD + (acc / sr) * H + i * GAP + GAP / 2) + 'px';
    });
  }

  function makeGutter(kind, i) {
    const g = document.createElement('div');
    g.className = 'tm-gut ' + kind;
    g.addEventListener('dblclick', () => {
      if (kind === 'v') grid.c = grid.c.map(() => 1); else grid.r = grid.r.map(() => 1);
      applySizes(); saveSizes();
    });
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const arr = kind === 'v' ? grid.c : grid.r;
      const total = (kind === 'v' ? panes.clientWidth : panes.clientHeight)
        - 2 * PAD - ((kind === 'v' ? grid.cols : grid.rows) - 1) * GAP;
      const sum = arr.reduce((a, b) => a + b, 0);
      const pxPerFr = total / sum;
      const pair = arr[i] + arr[i + 1];               // ayracin iki yanindaki toplam
      const startA = arr[i] * pxPerFr;
      const start = kind === 'v' ? e.clientX : e.clientY;
      // webview/iframe imleci yutmasin diye surukleme boyunca olaylari almasinlar
      panes.classList.add('resizing', kind === 'v' ? 'resizing-v' : 'resizing-h');
      g.classList.add('on');
      const move = (ev) => {
        const d = (kind === 'v' ? ev.clientX : ev.clientY) - start;
        const pairPx = pair * pxPerFr;
        const a = Math.min(pairPx - MIN_PX, Math.max(MIN_PX, startA + d));
        arr[i] = a / pxPerFr;
        arr[i + 1] = pair - arr[i];
        applySizes();
      };
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        panes.classList.remove('resizing', 'resizing-v', 'resizing-h');
        g.classList.remove('on');
        saveSizes();
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    return g;
  }

  function applySizes() {
    panes.style.gridTemplateColumns = tpl(grid.c);
    panes.style.gridTemplateRows = tpl(grid.r);
    placeGutters();
  }

  let panesRO = null;
  function applyLayout() {
    if (!panes) return;
    panes.classList.toggle('tiles', layout === 'tiles');
    panes.querySelectorAll('.tm-gut').forEach((g) => g.remove());
    if (layout === 'tiles') {
      const n = Math.max(1, tabs.length);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      grid = { cols, rows, ...sizesFor(cols, rows) };
      for (let i = 0; i < cols - 1; i++) panes.appendChild(makeGutter('v', i));
      for (let i = 0; i < rows - 1; i++) panes.appendChild(makeGutter('h', i));
      applySizes();
      if (!panesRO) { panesRO = new ResizeObserver(() => { if (layout === 'tiles') placeGutters(); }); panesRO.observe(panes); }
      for (const t of tabs) t.el.classList.add('shown');
      tabs.forEach((t, i) => { t.el.style.order = i; });
    } else {
      panes.style.gridTemplateColumns = '';
      panes.style.gridTemplateRows = '';
      for (const t of tabs) t.el.classList.remove('shown');
    }
    requestAnimationFrame(fitAll);
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function openPicked() {
    // Electron'da isletim sisteminin klasor secicisi var. Tarayicida yok: onun
    // yerine panelin zaten bildigi klasorleri listeleyip bir de elle yol yazma
    // imkani veriyoruz.
    if (T.pickFolder) {
      const dir = await T.pickFolder();
      if (dir) open(dir);
      return;
    }
    const known = await fetch('/api/state').then((r) => r.json())
      .then((d) => [...new Set([...(d.live || []), ...(d.ended || [])].map((x) => x.cwd).filter(Boolean))])
      .catch(() => []);
    showPicker(known);
  }

  function showPicker(known) {
    const box = document.createElement('div');
    box.className = 'tm-picker';
    box.innerHTML = `
      <div class="tm-picker-in">
        <div class="tm-picker-head">${T2('termPick')}</div>
        <input type="text" placeholder="~/Projects/…" spellcheck="false" autocomplete="off">
        <div class="tm-picker-list">${known.map((k) =>
          `<button data-dir="${esc(k)}">${esc(k.replace(/^\/Users\/[^/]+/, '~'))}</button>`).join('')}</div>
        <div class="tm-picker-foot">
          <button class="tm-picker-go">${T2('termPickGo')}</button>
          <button class="tm-picker-x">${T2('close')}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const input = box.querySelector('input');
    input.focus();
    const kapat = () => box.remove();
    const git = (d) => { if (d && d.trim()) { kapat(); open(d.trim()); } };
    box.querySelector('.tm-picker-go').onclick = () => git(input.value);
    box.querySelector('.tm-picker-x').onclick = kapat;
    box.onpointerdown = (e) => { if (e.target === box) kapat(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') git(input.value); if (e.key === 'Escape') kapat(); };
    box.querySelectorAll('[data-dir]').forEach((b) => { b.onclick = () => git(b.dataset.dir); });
  }

  // opts.dev: projenin dev sunucusu icin mineClaude'un kendisinin actigi sekme
  // (bkz. watchDev). Arka planda acilir, Claude sekmesinin yanina, geri yuklenmez.
  async function open(cwd, command, resumeSessionId, opts = {}) {
    if (!panes) return null;
    // Ayni klasorde ikinci bir terminal (ikinci bir Claude sureci) ayni dosyalari
    // ayni anda degistirmeye kalkabilir. Ozel bir sey istenmediyse ve o klasor
    // icin zaten acik bir sekme varsa, yenisini acmak yerine ona geciyoruz.
    // Resume bunun disinda: belirli bir konusmaya donmek istenmis, mevcut
    // sekmeye atlamak o istegi sessizce yutardi.
    if (!command && !resumeSessionId) {
      const existing = tabs.find((t) => t.cwd === cwd && !t.dead && !t.web && !t.devTab);
      if (existing) { select(existing); return; }
    }
    const el = document.createElement('div');
    el.className = 'tm-pane';
    panes.appendChild(el);

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: theme(),
      minimumContrastRatio: minContrast(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    term.open(el);
    fit.fit();

    let info;
    try {
      // light: acik temada pty.js claude'u --settings ile aciyor, yoksa
      // Claude Code koyu tema renklerini krem zemine basiyor.
      info = await T.create({
        cwd, cols: term.cols, rows: term.rows, command, resumeSessionId,
        light: !!cssVar('--term-light', ''),
      });
    } catch (e) {
      term.write('\r\n  terminal acilamadi: ' + String(e.message || e) + '\r\n');
      return;
    }

    const t = { ...info, term, fit, search, el, dead: false };
    if (opts.dev) { t.devTab = true; t.title = t.title + ' · dev'; }
    // Sayac yalniz etkin sekme icin: izgarada digerlerinden gelen sonuc ustune yazmasin
    search.onDidChangeResults((r) => { if (t === active) showCount(r); });
    // xterm.js'de attachCustomKeyEventHandler tek bir isleyici tutuyor — ikinci
    // cagri birinciyi sessizce eziyordu. Ctrl/Cmd+V (native panoyu okuyup
    // yapistirma) ile Ctrl+C (secim yokken ^C gondersin, bazi tarayicilar bunu
    // "kopyala" saniyor) tek isleyicide birlesti.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        e.stopPropagation();
        D.term.readClipboard().then((r) => {
          if (r && r.text) term.paste(r.text);
          else if (r && r.imagePath) term.paste(`"${r.imagePath}"`);
        });
        return false;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C') && !term.hasSelection()) {
        T.write(t.id, '\x03');
        e.preventDefault();
        return false;
      }
      return true;
    });
    // Olcumu elle zamanlamak tutmuyordu: izgaraya gecince rAF, grid yerlesmeden
    // once calisip her pane'i tam genislik saniyordu. Kutu ne zaman degisirse
    // olcum o zaman yapilsin.
    t.ro = new ResizeObserver(() => fitOne(t));
    t.ro.observe(el);
    el.addEventListener('mousedown', () => { if (active !== t) select(t); });
    term.onData((d) => T.write(t.id, d));
    term.onResize(({ cols, rows }) => T.resize(t.id, cols, rows));
    const at = opts.after ? tabs.indexOf(opts.after) : -1;
    if (at >= 0) tabs.splice(at + 1, 0, t); else tabs.push(t);
    saveRestore();
    applyLayout();
    if (opts.dev) drawStrip();
    else { select(t); term.focus(); }
    if (!command && !opts.dev) openProjectWeb(t);
    return t;
  }

  // Projenin sitesi (bkz. server.js projectWeb): terminal acilinca yaninda, arka planda.
  // O adres zaten bir sekmede aciksa ikincisini acmiyoruz.
  const sameSite = (a, b) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };
  function openProjectWeb(t) {
    if (localStorage.getItem('cc.webAuto') === '0' || !t.cwd) return;
    fetch('/api/project-web?cwd=' + encodeURIComponent(t.cwd))
      .then((r) => r.json())
      .then((d) => {
        if (!d || !tabs.includes(t)) return;
        if (d.dev && d.dev.length) watchDev(t, d.dev, d.devCmd || '');
        if (!d.url) return;
        t.site = d.url;
        if (tabs.some((x) => x.web && x.url && sameSite(x.url, d.url))) return;
        openWeb(d.url, { quiet: true, after: t });
      })
      .catch(() => {});
  }

  // Dev sunucusu (bkz. server.js devCandidates/devCommand): Claude sekmesi acik
  // oldugu surece projenin dev portlarini yokluyoruz; biri acilinca adresi
  // tarayici sekmesinde aciyoruz. Ilk bakista hicbiri acik degilse ve projenin bir
  // dev komutu varsa (Ionic'te `ionic serve`) onu yandaki bir terminal sekmesinde
  // kendimiz baslatiyoruz — gorunur, istenince kapatilir. Kimse sormak zorunda kalmasin.
  const isLocal = (u) => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(new URL(u).hostname); } catch { return false; } };
  const portOf = (u) => { try { return new URL(u).port; } catch { return ''; } };

  function watchDev(t, urls, cmd) {
    const ports = [...new Set(urls.map(portOf).filter(Boolean))];
    if (!ports.length || t.devWatch) return;
    t.devWatch = true;
    const started = Date.now();
    let first = true, timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const tick = () => {
      if (!tabs.includes(t) || t.dead || localStorage.getItem('cc.webAuto') === '0' || Date.now() - started > 3 * 3600e3) return stop();
      fetch('/api/port-open?ports=' + ports.join(','))
        .then((r) => r.json())
        .then((d) => {
          if (!timer) return;
          const open = ((d && d.open) || []).map(String);
          const hit = urls.find((u) => open.includes(portOf(u)));
          if (hit) {
            stop();
            if (tabs.some((x) => x.web && x.url && sameSite(x.url, hit))) return;   // terminal ciktisindan zaten acildi
            const dev = t.devTabRef && tabs.includes(t.devTabRef) ? t.devTabRef : t;
            openWeb(hit, { quiet: true, after: dev });
            return;
          }
          if (first && cmd && !t.devTabRef) {
            t.devTabRef = true;                  // ikinci kez baslatmayalim
            open(t.cwd, cmd, undefined, { dev: true, after: t }).then((dt) => { t.devTabRef = dt || null; });
          }
          first = false;
        })
        .catch(() => {});
    };
    timer = setInterval(tick, 3000);
    tick();
  }

  // Bir tarayici sekmesi hangi projenin? Seritte solundaki ilk terminal.
  function projectOf(w) {
    for (let i = tabs.indexOf(w) - 1; i >= 0; i--) if (!tabs[i].web) return tabs[i];
    return null;
  }
  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

  // --- tarayici sekmesi ---
  // Kod beklerken internette gezinmek (ya da Claude'un actigi dev sunucusuna bakmak)
  // icin, terminallerin yaninda bir sekme. Masaustunde <webview>: kalici ayri oturum,
  // sag tik menusu, kisayollar ve yeni pencere -> yeni sekme ana surecte (electron/browser.js).
  // Tarayicida iframe; cogu site iframe'e izin vermedigi icin orada yalniz localhost ise yarar.
  // Adres cubugu tarayicilardaki gibi: adrese benziyorsa git, degilse ara.
  // "7789" -> localhost:7789 (Claude'un actigi dev sunucusu icin kisa yol).
  const SEARCH = 'https://www.google.com/search?q=';
  const normUrl = (raw) => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (/^\d{2,5}(\/.*)?$/.test(u)) return 'http://localhost:' + u;
    if (/^(https?|about):/i.test(u)) return u;
    if (/\s/.test(u)) return SEARCH + encodeURIComponent(u);
    // localhost:3000, 127.0.0.1, 192.168.1.5:8080/x, ornek.com, ornek.com.tr/yol
    const m = u.match(/^([^/?#]+)/)[1];
    if (/^localhost(:\d+)?$/i.test(m) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(m)) return 'http://' + u;
    if (/^[\p{L}\d-]+(\.[\p{L}\d-]+)*\.[\p{L}]{2,}(:\d+)?$/u.test(m)) return 'https://' + u;
    return SEARCH + encodeURIComponent(u);
  };
  const urlTitle = (u) => { try { return new URL(u).host || u; } catch { return u; } };

  // Webview icinden gelen yeni sekme istekleri ve kisayollar (bkz. electron/browser.js)
  if (D && D.web) {
    D.web.onOpen(({ url }) => { if (url) openWeb(url); });
    D.web.onKey(({ wcId, act }) => {
      const t = tabs.find((x) => x.web && x.wcId === wcId);
      if (!t) return;
      if (act === 'focus-url') { t.input.focus(); t.input.select(); }
    });
  }

  function openWeb(raw, { quiet = false, after = null } = {}) {
    if (!panes) return null;
    const desktop = !!D;
    const el = document.createElement('div');
    el.className = 'tm-pane tm-web';
    el.innerHTML = `
      <div class="tm-web-bar">
        ${desktop ? `<button class="tm-web-back" title="${esc(T2('webBack'))}  (Alt+←)">${ICONS.back}</button>
        <button class="tm-web-fwd" title="${esc(T2('webFwd'))}  (Alt+→)">${ICONS.fwd}</button>` : ''}
        <button class="tm-web-reload" title="${esc(T2('webReload'))}">${ICONS.reload}</button>
        <input type="text" spellcheck="false" autocomplete="off" placeholder="${esc(T2('webPh'))}">
        <button class="tm-web-pin">${ICONS.pin}</button>
        <button class="tm-web-ext" title="${esc(T2('webExt'))}">${ICONS.external}</button>
      </div>
      <div class="tm-web-body"></div>`;
    panes.appendChild(el);
    const input = el.querySelector('input');
    const body = el.querySelector('.tm-web-body');
    const reloadBtn = el.querySelector('.tm-web-reload');
    const t = { id: 'web-' + (++webSeq), web: true, url: '', title: T2('webTab'), icon: null,
      loading: false, wcId: null, el, input, view: null, dead: false };

    const retitle = (title) => { title = title || urlTitle(t.url) || T2('webTab'); if (t.title !== title) { t.title = title; drawStrip(); } };
    const setUrl = (u) => {
      t.url = u;
      if (document.activeElement !== input) input.value = u;
      saveRestore();
      drawStrip();
    };
    const setLoading = (on) => {
      t.loading = on;
      reloadBtn.innerHTML = on ? ICONS.stop : ICONS.reload;
      reloadBtn.title = T2(on ? 'webStop' : 'webReload');
      drawStrip();
    };
    const overlay = (html) => {
      let o = body.querySelector('.tm-web-empty');
      if (!html) { if (o) o.remove(); return; }
      if (!o) { o = document.createElement('div'); o.className = 'tm-web-empty'; body.appendChild(o); }
      o.innerHTML = html;
      return o;
    };

    const go = (v) => {
      const u = normUrl(v);
      if (!u) return;
      setUrl(u);
      overlay(null);
      if (t.view) { if (desktop) t.view.loadURL(u).catch(() => {}); else t.view.src = u; return; }
      const w = document.createElement(desktop ? 'webview' : 'iframe');
      if (desktop) {
        // Oturum/partition ve guvenlik ayarlari ana surecte (will-attach-webview).
        // allowpopups: window.open ana surecin handler'ina ulassin, o da yeni sekme acsin.
        w.setAttribute('allowpopups', '');
        w.addEventListener('dom-ready', () => { try { t.wcId = w.getWebContentsId(); } catch { /* */ } });
        w.addEventListener('did-navigate', (e) => { setUrl(e.url); t.icon = null; retitle(); });
        w.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) setUrl(e.url); });
        w.addEventListener('page-title-updated', (e) => retitle(e.title));
        w.addEventListener('page-favicon-updated', (e) => { t.icon = (e.favicons || [])[0] || null; drawStrip(); });
        w.addEventListener('did-start-loading', () => setLoading(true));
        w.addEventListener('did-stop-loading', () => setLoading(false));
        w.addEventListener('did-fail-load', (e) => {
          // -3: kullanici durdurdu / yeni gezinme eskisini kesti — hata degil
          if (!e.isMainFrame || e.errorCode === -3) return;
          const o = overlay(`<b>${esc(T2('webFail'))}</b><div>${esc(e.validatedURL || t.url)}</div>
            <div>${esc(e.errorDescription || '')}</div><button>${esc(T2('webRetry'))}</button>`);
          o.querySelector('button').onclick = () => { overlay(null); w.reload(); };
        });
      } else {
        w.addEventListener('load', () => retitle());
      }
      w.src = u;
      body.innerHTML = '';
      body.appendChild(w);
      t.view = w;
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(input.value); if (t.view) t.view.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); input.value = t.url; if (t.view) t.view.focus(); }
    };
    input.onfocus = () => input.select();
    input.onblur = () => { if (!input.value.trim()) input.value = t.url; };
    const q = (c) => el.querySelector(c);
    if (desktop) {
      q('.tm-web-back').onclick = () => { if (t.view && t.view.canGoBack()) t.view.goBack(); };
      q('.tm-web-fwd').onclick = () => { if (t.view && t.view.canGoForward()) t.view.goForward(); };
    }
    reloadBtn.onclick = () => {
      if (!t.view) return go(input.value);
      if (!desktop) { t.view.src = t.url; return; }
      if (t.loading) t.view.stop(); else t.view.reload();
    };
    q('.tm-web-ext').onclick = () => { if (t.url) window.open(t.url, '_blank'); };
    // 📌 bu adresi (sadece kok: https://site/) soldaki terminalin projesine yaz
    t.pinBtn = q('.tm-web-pin');
    t.pinBtn.onclick = () => {
      const p = projectOf(t);
      if (!p || !t.url) return;
      const dev = isLocal(t.url);
      let url; try { url = dev ? t.url : new URL(t.url).origin + '/'; } catch { return; }
      if (dev ? p.devUrl === url : (p.site && sameSite(p.site, url))) return;
      fetch('/api/project-web', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: p.cwd, url, kind: dev ? 'dev' : 'site' }) })
        .then((r) => r.json()).then((d) => { if (d && d.ok) { if (dev) p.devUrl = url; else p.site = url; drawStrip(); } })
        .catch(() => {});
    };
    // webview icindeki tiklama ust belgeye mousedown olarak gelmiyor; odakla da secelim.
    el.addEventListener('mousedown', () => { if (active !== t) select(t); });
    el.addEventListener('focusin', () => { if (active !== t) select(t); });

    // Bir terminalden geldiyse onun hemen yanina: hangi projenin sayfasi oldugu belli olsun
    const at = after ? tabs.indexOf(after) : -1;
    if (at >= 0) tabs.splice(at + 1, 0, t); else tabs.push(t);
    const u = normUrl(raw);
    if (u) go(u); else overlay(esc(T2('webEmpty')));
    saveRestore();
    applyLayout();
    if (!quiet) { select(t); if (!u) requestAnimationFrame(() => input.focus()); }
    else drawStrip();
    return t;
  }

  function select(t) {
    const prev = active;
    active = t;
    for (const x of tabs) x.el.classList.toggle('on', x === t);
    const empty = panes.querySelector('.tm-empty');
    if (empty) empty.remove();
    drawStrip();
    if (prev !== t) refind(prev);
    // Arama cubugu acikken odak orada kalsin; yoksa terminale
    requestAnimationFrame(() => { fitAll(); if (find && !find.box.hidden) find.input.focus(); else focusTab(t); });
  }

  function focusTab(t) {
    if (!t.web) { t.term.focus(); return; }
    if (t.view) t.view.focus(); else t.input.focus();
  }

  function selectIndex(i) {
    const t = tabs[i];
    if (t) select(t);
  }

  function close(t) {
    if (t.ro) t.ro.disconnect();
    if (!t.web) { T.kill(t.id); t.term.dispose(); }
    t.el.remove();
    const i = tabs.indexOf(t);
    if (i >= 0) tabs.splice(i, 1);
    saveRestore();
    if (active === t) active = tabs[Math.min(i, tabs.length - 1)] || null;
    applyLayout();
    if (active) select(active); else { drawStrip(); showEmpty(); }
  }

  function fitOne(t) {
    if (t.web) return;               // webview/iframe kendi boyutunu CSS'ten aliyor
    // Gizli pane'in olcusu 0: olcmeye calisirsak xterm anlamsiz bir boyuta duser
    if (!t.el.isConnected || !t.el.clientWidth || !t.el.clientHeight) return;
    // mount() render() her saniye cagirdigi icin fitAll buraya da her saniye
    // dusuyordu. Kutu boyutu degismediyse yeniden olcmeye hic gerek yok.
    if (t.el.clientWidth === t._fitW && t.el.clientHeight === t._fitH) return;
    try {
      // Izgaradan tekliye gecerken terminal iki katina buyuyor; xterm tamponu
      // yeniden akitirken gorunum penceresi icerigin disinda bir yere
      // kalabiliyor ve ekran bos gorunuyor. Altta duruyorduysak altta kalalim.
      const b = t.term.buffer.active;
      const altta = b.viewportY >= b.baseY;
      t.fit.fit();
      if (altta) t.term.scrollToBottom();
      // Hakan'in olcu onbellegi (bkz. yukaridaki erken cikis) + bizim transport.
      t._fitW = t.el.clientWidth;
      t._fitH = t.el.clientHeight;
      T.resize(t.id, t.term.cols, t.term.rows);
    } catch { /* pane henuz yerlesmemis olabilir */ }
  }
  // Sekme kipinde yalniz gorunen olculebilir; izgarada hepsi gorunuyor.
  function fitAll() {
    if (layout === 'tiles') { for (const t of tabs) fitOne(t); }
    else if (active) fitOne(active);
  }

  T.onData(({ id, data }) => {
    const t = tabs.find((x) => x.id === id);
    if (t) { t.term.write(data); sniffUrl(t, data); }
  });

  // --- dev sunucusu adresi -> tarayici sekmesi ---
  // Vite/Next/CRA/Astro... hepsi basarken "Local: http://localhost:5173/" basiyor;
  // Claude arka planda `npm run dev` calistirinca da o satir terminale dusuyor.
  // Boyle bir adres gorunce onu terminalin hemen yaninda bir tarayici sekmesinde
  // aciyoruz — arka planda, odagi calmadan (Claude'a yazarken sekme degismesin).
  // Ayni adres zaten aciksa yeni sekme yerine onu yeniliyoruz. Ayar: cc.webAuto.
  const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g;
  const LOCAL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}[^\s'"<>()[\]{}`]*/gi;
  const ownPort = location.port || (location.protocol === 'https:' ? '443' : '80');

  function sniffUrl(t, data) {
    // Parca sinirinda bolunen adres icin onceki parcanin sonunu da tariyoruz.
    const raw = (t._tail || '') + data;
    t._tail = raw.slice(-300);
    if (!raw.includes('://') || localStorage.getItem('cc.webAuto') === '0') return;
    const text = raw.replace(ANSI_RE, '');
    t.webSeen = t.webSeen || new Set();
    for (const m of text.matchAll(LOCAL_RE)) {
      // Satirin sonunda biten eslesme yarim olabilir ("...:51" + sonraki parcada "73/")
      if (m.index + m[0].length >= text.length) continue;
      let u;
      try { u = new URL(m[0].replace(/[.,;:!?]+$/, '')); } catch { continue; }
      if (u.port === ownPort) continue;                         // mineClaude'un kendisi
      if (/callback|oauth/i.test(u.pathname)) continue;          // giris akislari
      u.hostname = 'localhost';
      const key = u.origin;
      if (t.webSeen.has(key)) continue;                           // ekran yeniden cizildi
      t.webSeen.add(key);
      const open = tabs.find((x) => x.web && x.url && x.url.startsWith(key));
      if (open) { if (open.view && open.view.reload) open.view.reload(); continue; }
      openWeb(u.href, { quiet: true, after: t });
    }
  }
  T.onExit(({ id, code, gone }) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    t.dead = true;
    t.term.write(`\r\n\x1b[2m[${gone ? T2('termGone') : T2('termClosed') + ' · ' + code}]\x1b[0m\r\n`);
    drawStrip();
  });

  // Baglanti geri gelince acik sekmeleri sunucudaki PTY'lere yeniden bagla.
  if (T.onReconnect) T.onReconnect(async () => {
    for (const t of tabs) {
      if (t.dead || t.web) continue;
      try { await T.reattach(t.id); T.resize(t.id, t.term.cols, t.term.rows); }
      catch { /* PTY gitmisse 'gone' mesaji zaten geliyor */ }
    }
  });

  window.addEventListener('resize', () => fitAll());

  window.MTerm = {
    mount,
    open,                              // panel/kart "burada terminal ac" icin
    openPicked,                        // ⌘T
    closeActive: () => { if (active) { close(active); return true; } return false; },
    findOpen: openFind,                // ⌘F
    findClose: closeFind,              // Esc (index.html'deki genel Esc zinciri)
    findStep: (back) => { if (find && !find.box.hidden && find.input.value) { runFind(back ? 'prev' : 'next'); return true; } return false; }, // ⌘G / ⌘⇧G
    selectIndex,                       // ⌘1-9
    // Panel bir session'in tty'sini biliyor: bu sekmelerden biri mi? Windows'ta
    // ConPTY'nin /dev/ttysNNN karsiligi yok, ptsName hep null donuyor — tty ile
    // eslesme oradaki hicbir sekmeyi bulamiyor (hepsi ayni "null" ile eslesmeye
    // calisip ilk sekmede takili kalirdi). cwd'ye dusuyoruz, o her platformda var.
    tabForTty: (tty, cwd) => (tty ? tabs.find((t) => t.tty === tty) : tabs.find((t) => t.cwd === cwd && !t.dead && !t.web && !t.devTab)) || null,
    // Panel bir sekmede hangi oturumun kostugunu biliyor; geri yuklemede
    // `--resume <id>` diyebilmek icin onu sekmeye yaziyoruz.
    // Ofiste el kaldiran kisi neyse, sekmede amber baslik o: bu sekmedeki
    // oturum senden input bekliyor. Ofiste masasinda mi lounge'da mi oturdugu
    // (atDesk, bkz. office3d.js) sekmede de ayni ayrimla gorunsun istedik.
    noteStatus: (tty, cwd, status) => {
      const t = tty ? tabs.find((x) => x.tty === tty) : tabs.find((x) => x.cwd === cwd && !x.dead && !x.web && !x.devTab);
      if (!t) return;
      const waiting = status === 'waiting';
      const lounge = status === 'idle' || status === 'unknown';
      if (t.status !== status || t.waiting !== waiting || t.lounge !== lounge) {
        t.status = status; t.waiting = waiting; t.lounge = lounge; drawStrip();
      }
    },
    noteSession: (tty, cwd, sessionId) => {
      const t = tty ? tabs.find((x) => x.tty === tty) : tabs.find((x) => x.cwd === cwd && !x.dead && !x.web && !x.devTab);
      if (t && sessionId && t.sessionId !== sessionId) { t.sessionId = sessionId; saveRestore(); }
    },
    pendingCount: () => pending.length,
    list: () => tabs.map((t) => ({ id: t.id, cwd: t.cwd, title: t.title, tty: t.tty, dead: t.dead, web: !!t.web })),
    openWeb,                           // tarayici sekmesi
    // Sag paneldeki Gecmis sekmesinden mesaj: sanki klavyeden yazilmis gibi. term.paste
    // Claude'un actigi "bracketed paste" kipine uyuyor — cok satirli metin tek mesaj olarak
    // gidiyor, satir sonlari erken gondermiyor. Enter'i biraz sonra ayri basiyoruz ki
    // yapistirma bitmeden gonderilmesin.
    sendText: (id, text) => {
      const t = tabs.find((x) => x.id === id && !x.web && !x.dead);
      if (!t) return false;
      t.term.paste(String(text).replace(/\r\n?/g, '\n'));
      setTimeout(() => { if (!t.dead) T.write(t.id, '\r'); }, 80);
      return true;
    },
    // `mineclaude --open`: istenen sayfa, istendigi icin one gelir. O proje icin zaten
    // ayni sitenin sekmesi varsa yenisini acmak yerine onu o adrese goturuyoruz.
    openUrl: ({ url, cwd }) => {
      const term = tabs.find((x) => !x.web && !x.devTab && !x.dead && x.cwd === cwd)
        || tabs.find((x) => !x.web && !x.dead && x.cwd === cwd) || null;
      const same = tabs.find((x) => x.web && x.url && sameSite(x.url, url));
      if (same) {
        select(same);
        if (same.url !== url && same.view) { if (same.view.loadURL) same.view.loadURL(url).catch(() => {}); else same.view.src = url; }
        return;
      }
      openWeb(url, { after: term });
    },
    selectById: (id) => { const t = tabs.find((x) => x.id === id); if (t) select(t); return !!t; },
    conn: () => (T.state ? T.state() : { kind: T.kind }),
    count: () => tabs.length,
    layout: () => layout,
    setLayout,
    setTasksOpen: (v) => { tasksOpen = !!v; if (strip) drawStrip(); },
    fit: fitAll,
    // Tema degisince sadece YENI yazilan icerik dogru renklenir. Ekranda
    // zaten duran metni terminali sifirlayip yeniden yazarak duzeltmeyi
    // denedik: gorunumu duzeltiyor ama xterm'in tamponuyla gercek surecin
    // (kabuk/claude) kendi imlec/mod takibi birbirinden kopuyor — ardindan
    // yazilan karakterler yanlis yerde beliriyor (denendi, dogrulandi, hem
    // duz kabukta hem tam ekranda). Bu yuzden burada sadece ayarlari
    // guncelliyoruz; ekranda halihazirda duran metin eski renginde kalir.
    retheme: () => {
      for (const t of tabs) {
        if (t.web) continue;
        t.term.options.theme = theme();
        t.term.options.minimumContrastRatio = minContrast();
      }
    },
  };
  window.dispatchEvent(new Event('mterm-ready'));
}
