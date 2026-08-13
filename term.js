/* mineClaude — gomulu terminaller.
   Her sekme bir PTY; PTY'ler ana surecte, burasi sadece cizim ve klavye.
   xterm.js vendor'da (three.js gibi), node-pty istege bagli: yoksa bu gorunum
   hic listelenmiyor. */

import { Terminal } from './vendor/xterm.module.js';
import { FitAddon } from './vendor/xterm-addon-fit.module.js';

const D = window.mineClaudeDesktop;
if (D && D.term) {
  const tabs = [];              // { id, cwd, title, term, fit, el, dead }
  let active = null;
  let host = null, strip = null, panes = null;
  let T = (k) => k;
  // 'tabs': tek terminal tam ekran · 'tiles': hepsi ayni anda, izgara
  let layout = localStorage.getItem('cc.termLayout') === 'tiles' ? 'tiles' : 'tabs';

  // Kapanista acik olan sekmeler. Uygulama PTY'leri surecinde tuttugu icin cikista
  // hepsi oluyor; burada ne oldugunu hatirlayip acilista geri yuklemeyi *oneriyoruz*.
  // Kendiliginden acmiyoruz: bes sekme, bes Claude oturumu demek.
  const RESTORE_KEY = 'cc.termRestore';
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(RESTORE_KEY) || '[]'); } catch { pending = []; }
  if (!Array.isArray(pending)) pending = [];

  function saveRestore() {
    const snap = tabs.filter((t) => !t.dead).map((t) => ({ cwd: t.cwd, title: t.title, sessionId: t.sessionId || null }));
    try { localStorage.setItem(RESTORE_KEY, JSON.stringify(snap)); } catch { /* dolu olabilir */ }
  }

  const theme = () => {
    const cs = getComputedStyle(document.body);
    const v = (n, d) => (cs.getPropertyValue(n) || d).trim();
    return {
      background: v('--panel', '#16191e'),
      foreground: v('--text', '#e7eaef'),
      cursor: v('--idle', '#5b9cf0'),
      selectionBackground: 'rgba(91,156,240,.30)',
    };
  };

  function mount(container, translate) {
    if (translate) T = translate;
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
           <span>${T('termRestoreAsk', pending.length)}</span>
           <button class="tm-yes">${T('termRestoreYes')}</button>
           <button class="tm-no">${T('termRestoreNo')}</button>
           <div class="tm-restore-list">${pending.map((r) => esc(r.title)).join(' · ')}</div>
         </div>`
      : '';
    panes.innerHTML = `<div class="tm-empty">
      ${teklif}
      <div>${T('termEmpty')}</div>
      <button class="tm-open">${T('termNew')}</button>
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
      // ve bos kabukla degil.
      await open(r.cwd, r.sessionId ? `claude --resume ${r.sessionId} || claude` : undefined);
    }
    saveRestore();
  }

  function drawStrip() {
    strip.innerHTML = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.className = 'tm-tab' + (t === active ? ' on' : '') + (t.dead ? ' dead' : '');
      b.title = t.cwd;
      b.innerHTML = `<span>${esc(t.title)}</span>`;
      b.onclick = () => select(t);
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
    plus.title = T('termNew') + '  (⌘T)';
    plus.onclick = () => openPicked();
    strip.appendChild(plus);

    const lay = document.createElement('button');
    lay.className = 'tm-lay';
    lay.title = layout === 'tabs' ? T('termTiles') : T('termTabs');
    lay.innerHTML = layout === 'tabs'
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="9" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="1.8" y="9" width="5.2" height="5.2" rx="1"/><rect x="9" y="9" width="5.2" height="5.2" rx="1"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4"/><path d="M1.8 6.2h12.4"/></svg>';
    lay.onclick = () => setLayout(layout === 'tabs' ? 'tiles' : 'tabs');
    strip.appendChild(lay);
  }

  function setLayout(next) {
    layout = next;
    localStorage.setItem('cc.termLayout', layout);
    applyLayout();
    drawStrip();
  }

  // Izgarada kolon sayisi: kareye yakin bir duzen. 3 terminal -> 2x2'nin ucu dolu.
  function applyLayout() {
    if (!panes) return;
    panes.classList.toggle('tiles', layout === 'tiles');
    if (layout === 'tiles') {
      const n = Math.max(1, tabs.length);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      panes.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
      panes.style.gridTemplateRows = `repeat(${rows}, minmax(0,1fr))`;
      for (const t of tabs) t.el.classList.add('shown');
    } else {
      panes.style.gridTemplateColumns = '';
      panes.style.gridTemplateRows = '';
      for (const t of tabs) t.el.classList.remove('shown');
    }
    requestAnimationFrame(fitAll);
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function openPicked() {
    const dir = await D.term.pickFolder();
    if (dir) open(dir);
  }

  async function open(cwd, command) {
    if (!panes) return;
    const el = document.createElement('div');
    el.className = 'tm-pane';
    panes.appendChild(el);

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: theme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    let info;
    try {
      info = await D.term.create({ cwd, cols: term.cols, rows: term.rows, command });
    } catch (e) {
      term.write('\r\n  terminal acilamadi: ' + String(e.message || e) + '\r\n');
      return;
    }

    const t = { ...info, term, fit, el, dead: false };
    // Olcumu elle zamanlamak tutmuyordu: izgaraya gecince rAF, grid yerlesmeden
    // once calisip her pane'i tam genislik saniyordu. Kutu ne zaman degisirse
    // olcum o zaman yapilsin.
    t.ro = new ResizeObserver(() => fitOne(t));
    t.ro.observe(el);
    el.addEventListener('mousedown', () => { if (active !== t) select(t); });
    term.onData((d) => D.term.write(t.id, d));
    term.onResize(({ cols, rows }) => D.term.resize(t.id, cols, rows));
    tabs.push(t);
    saveRestore();
    applyLayout();
    select(t);
    term.focus();
  }

  function select(t) {
    active = t;
    for (const x of tabs) x.el.classList.toggle('on', x === t);
    const empty = panes.querySelector('.tm-empty');
    if (empty) empty.remove();
    drawStrip();
    requestAnimationFrame(() => { fitAll(); t.term.focus(); });
  }

  function selectIndex(i) {
    const t = tabs[i];
    if (t) select(t);
  }

  function close(t) {
    if (t.ro) t.ro.disconnect();
    D.term.kill(t.id);
    t.term.dispose();
    t.el.remove();
    const i = tabs.indexOf(t);
    if (i >= 0) tabs.splice(i, 1);
    saveRestore();
    if (active === t) active = tabs[Math.min(i, tabs.length - 1)] || null;
    applyLayout();
    if (active) select(active); else { drawStrip(); showEmpty(); }
  }

  function fitOne(t) {
    // Gizli pane'in olcusu 0: olcmeye calisirsak xterm anlamsiz bir boyuta duser
    if (!t.el.isConnected || !t.el.clientWidth || !t.el.clientHeight) return;
    try {
      t.fit.fit();
      D.term.resize(t.id, t.term.cols, t.term.rows);
    } catch { /* pane henuz yerlesmemis olabilir */ }
  }
  // Sekme kipinde yalniz gorunen olculebilir; izgarada hepsi gorunuyor.
  function fitAll() {
    if (layout === 'tiles') { for (const t of tabs) fitOne(t); }
    else if (active) fitOne(active);
  }

  D.term.onData(({ id, data }) => {
    const t = tabs.find((x) => x.id === id);
    if (t) t.term.write(data);
  });
  D.term.onExit(({ id, code }) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    t.dead = true;
    t.term.write(`\r\n\x1b[2m[${T('termClosed')} · ${code}]\x1b[0m\r\n`);
    drawStrip();
  });

  window.addEventListener('resize', () => fitAll());

  window.MTerm = {
    mount,
    open,                              // panel/kart "burada terminal ac" icin
    openPicked,                        // ⌘T
    closeActive: () => { if (active) { close(active); return true; } return false; },
    selectIndex,                       // ⌘1-9
    // Panel bir session'in tty'sini biliyor: bu sekmelerden biri mi?
    tabForTty: (tty) => (tty ? (tabs.find((t) => t.tty === tty) || null) : null),
    // Panel bir sekmede hangi oturumun kostugunu biliyor; geri yuklemede
    // `--resume <id>` diyebilmek icin onu sekmeye yaziyoruz.
    noteSession: (tty, sessionId) => {
      const t = tabs.find((x) => x.tty === tty);
      if (t && sessionId && t.sessionId !== sessionId) { t.sessionId = sessionId; saveRestore(); }
    },
    pendingCount: () => pending.length,
    list: () => tabs.map((t) => ({ id: t.id, cwd: t.cwd, title: t.title, tty: t.tty, dead: t.dead })),
    selectById: (id) => { const t = tabs.find((x) => x.id === id); if (t) select(t); return !!t; },
    count: () => tabs.length,
    layout: () => layout,
    setLayout,
    fit: fitAll,
    retheme: () => { for (const t of tabs) t.term.options.theme = theme(); },
  };
  window.dispatchEvent(new Event('mterm-ready'));
}
