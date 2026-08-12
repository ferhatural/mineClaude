/* mineClaude — gomulu terminaller.
   Her sekme bir PTY; PTY'ler ana surecte, burasi sadece cizim ve klavye.
   xterm.js vendor'da (three.js gibi), node-pty istege bagli: yoksa bu gorunum
   hic listelenmiyor. */

import { Terminal } from './vendor/xterm.module.js';
import { FitAddon } from './vendor/xterm-addon-fit.module.js';

const D = window.mineClaudeDesktop;
if (D && D.term) {
  const tabs = [];              // { id, cwd, title, term, fit, el, tabEl, dead }
  let active = null;
  let host = null, strip = null, panes = null;
  let T = (k) => k;

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
    if (host && host.isConnected) { fitActive(); return; }
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
    if (!tabs.length) showEmpty();
  }

  function showEmpty() {
    panes.innerHTML = `<div class="tm-empty">
      <div>${T('termEmpty')}</div>
      <button class="tm-open">${T('termNew')}</button>
    </div>`;
    panes.querySelector('.tm-open').onclick = () => openPicked();
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
    plus.title = T('termNew');
    plus.onclick = () => openPicked();
    strip.appendChild(plus);
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
    term.onData((d) => D.term.write(t.id, d));
    term.onResize(({ cols, rows }) => D.term.resize(t.id, cols, rows));
    tabs.push(t);
    select(t);
    term.focus();
  }

  function select(t) {
    active = t;
    for (const x of tabs) x.el.classList.toggle('on', x === t);
    // bos ekran varsa kalksin
    const empty = panes.querySelector('.tm-empty');
    if (empty) empty.remove();
    drawStrip();
    requestAnimationFrame(() => { fitActive(); t.term.focus(); });
  }

  function close(t) {
    D.term.kill(t.id);
    t.term.dispose();
    t.el.remove();
    const i = tabs.indexOf(t);
    if (i >= 0) tabs.splice(i, 1);
    if (active === t) active = tabs[tabs.length - 1] || null;
    if (active) select(active); else { drawStrip(); showEmpty(); }
  }

  function fitActive() {
    if (!active) return;
    try {
      active.fit.fit();
      D.term.resize(active.id, active.term.cols, active.term.rows);
    } catch { /* gorunmezken olcum tutmaz */ }
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

  window.addEventListener('resize', () => fitActive());

  window.MTerm = {
    mount,
    open,                              // panel/kart "burada terminal ac" icin
    count: () => tabs.length,
    fit: fitActive,
    retheme: () => { for (const t of tabs) t.term.options.theme = theme(); },
  };
  window.dispatchEvent(new Event('mterm-ready'));
}
