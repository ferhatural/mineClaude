/* mineClaude — gomulu terminaller.
   Her sekme bir PTY; PTY'ler ana surecte, burasi sadece cizim ve klavye.
   xterm.js vendor'da (three.js gibi), node-pty istege bagli: yoksa bu gorunum
   hic listelenmiyor. */

import { Terminal } from './vendor/xterm.module.js';
import { FitAddon } from './vendor/xterm-addon-fit.module.js';
import { SearchAddon } from './vendor/xterm-addon-search.module.js';

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
  let sonMesaj = 0;

  // Mobil agda kopan bir baglanti cogu zaman onclose uretmiyor: FIN/RST hic
  // gelmedigi icin TCP yari acik kaliyor, tarayici soketi canli saniyor ve
  // yukaridaki yeniden baglanma mantigi hic tetiklenmiyor. Sonuc: yazdigin
  // komut gidiyor, cevabi hic gelmiyor, uygulama da sana kopuk oldugunu
  // soylemiyor. Gercek kullanimda (5G, disarida) tam olarak bu yasandi.
  //
  // Bu yuzden canliligi kendimiz olcuyoruz: 10sn'de bir ping, 25sn boyunca
  // hicbir mesaj gelmezse soketi biz kapatiyoruz. Kapaninca onclose zinciri
  // devreye girip yeniden baglaniyor ve sekmeler yeniden eslestiriliyor
  // (bkz. T.onReconnect).
  const PING_MS = 10000, SESSIZLIK_MS = 25000;
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    if (sonMesaj && Date.now() - sonMesaj > SESSIZLIK_MS) { try { ws.close(); } catch {} return; }
    try { ws.send(JSON.stringify({ t: 'ping' })); } catch {}
  }, PING_MS);

  const connect = () => {
    if (ws && ws.readyState === 1) return Promise.resolve(ws);
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      ws = new WebSocket(`${proto}://${location.host}/terminals`);
      ws.onmessage = (e) => {
        sonMesaj = Date.now();
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') return;          // yalniz canlilik kaniti, islenecek bir sey yok
        if (m.t === 'created' || m.t === 'attached' || m.t === 'error') {
          const w = waiting.get(m.ref);
          if (w) { waiting.delete(m.ref); m.t === 'error' ? w.reject(new Error(m.error)) : w.resolve(m); }
        } else if (m.t === 'data') for (const f of dataFns) f({ id: m.id, data: m.data });
        else if (m.t === 'exit') for (const f of exitFns) f({ id: m.id, code: m.code });
        else if (m.t === 'gone') for (const f of exitFns) f({ id: m.id, code: null, gone: true });
      };
      ws.onopen = () => { connecting = null; tries++; sonMesaj = Date.now(); resolve(ws); for (const f of openFns) f(); };
      ws.onerror = () => { connecting = null; reject(new Error('terminal baglantisi kurulamadi')); };
      // Tunel dusunce, tablet uyuyunca, ag degisince: PTY'ler sunucuda yasiyor,
      // tek yapmamiz gereken geri baglanip sekmeleri yeniden eslestirmek.
      ws.onclose = () => { connecting = null; setTimeout(() => connect().catch(() => {}), 1500); };
      sonMesaj = Date.now();
    });
    return connecting;
  };

  const send = (m) => connect().then((s) => s.send(JSON.stringify(m)));

  return {
    kind: 'web',
    // .catch(() => false) bilerek yok: ag hatasiyla "terminaller kapali"
    // cevabini ayirt etmek gerekiyor. Ilki gecici, ikincisi kalici.
    available: () => fetch('/api/terminals').then((r) => r.json()).then((d) => !!d.enabled),
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

// Acilista ag kopuksa bu istek basarisiz oluyordu ve terminal destegi o sayfa
// omru boyunca kapali kaliyordu: sag ustteki terminal dugmesi hic gelmiyor,
// baglanti geri gelse bile gelmiyor, tek care uygulamayi kapatip acmak. Tabletten
// calisirken ag kopmasi kural, istisna degil — o yuzden vazgecmiyoruz.
//
// Ayrim onemli: istek REDDEDILIRSE ag sorunu, tekrar deniyoruz. FALSE donerse
// sunucu --terminals'siz calisiyor demektir, beklemenin anlami yok.
// start() basariyla calisinca mterm-ready olayi sayfaya haber veriyor ve
// gorunum anahtari kendiliginde yeniden ciziliyor (bkz. index.html).
(function yoklaVeBasla(gecikme = 2000) {
  T.available()
    .then((ok) => { if (ok) start(); })
    .catch(() => setTimeout(() => yoklaVeBasla(Math.min(30000, gecikme * 1.6)), gecikme));
})();

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
  function setFont(delta) {
    fontSize = Math.min(22, Math.max(9, fontSize + delta));
    localStorage.setItem(FONT_KEY, String(fontSize));
    for (const t of tabs) t.term.options.fontSize = fontSize;
    fitAll();
  }

  const RESTORE_KEY = 'cc.termRestore';
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(RESTORE_KEY) || '[]'); } catch { pending = []; }
  if (!Array.isArray(pending)) pending = [];

  function saveRestore() {
    const snap = tabs.filter((t) => !t.dead).map((t) => ({ cwd: t.cwd, title: t.title, sessionId: t.sessionId || null }));
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
    // Serit host'a asili, panes'e degil: showEmpty() panes.innerHTML yazdiginda
    // silinmesin. Konumu yine panes'in ustune denk geliyor (host position:relative).
    host.appendChild(buildKeys());
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

  function drawStrip() {
    strip.innerHTML = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.className = 'tm-tab' + (t === active ? ' on' : '') + (t.dead ? ' dead' : '')
        + (t.waiting ? ' waiting' : '');
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
    plus.title = T2('termNew') + '  (⌘T)';
    plus.onclick = () => openPicked();
    strip.appendChild(plus);

    const lay = document.createElement('button');
    lay.className = 'tm-lay';
    lay.title = layout === 'tabs' ? T2('termTiles') : T2('termTabs');
    lay.innerHTML = layout === 'tabs'
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="9" y="1.8" width="5.2" height="5.2" rx="1"/><rect x="1.8" y="9" width="5.2" height="5.2" rx="1"/><rect x="9" y="9" width="5.2" height="5.2" rx="1"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="3" width="12.4" height="10" rx="1.4"/><path d="M1.8 6.2h12.4"/></svg>';
    lay.onclick = () => setLayout(layout === 'tabs' ? 'tiles' : 'tabs');
    strip.appendChild(lay);

    const tasksBtn = document.createElement('button');
    tasksBtn.className = 'tm-tasks-btn' + (tasksOpen ? ' on' : '');
    tasksBtn.title = T2('tasksTab');
    tasksBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">'
      + '<rect x="1.8" y="2.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 4h7.4"/>'
      + '<rect x="1.8" y="6.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 8h7.4"/>'
      + '<rect x="1.8" y="10.6" width="2.8" height="2.8" rx=".6"/><path d="M6.8 12h7.4"/></svg>';
    tasksBtn.onclick = () => window.dispatchEvent(new Event('term-tasks-toggle'));
    strip.appendChild(tasksBtn);

    // Tablette ⌘F yok; ayni is icin bir dugme.
    const fnd = document.createElement('button');
    fnd.className = 'tm-lay tm-findbtn' + (find && !find.box.hidden ? ' on' : '');
    fnd.title = T2('termFind') + '  (⌘F)';
    fnd.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>';
    fnd.onclick = () => (find && !find.box.hidden ? closeFind() : openFind());
    strip.appendChild(fnd);
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
      if (active) active.search.clearDecorations();
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
    if (!host || !active) return false;
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
    for (const t of tabs) t.search.clearDecorations();
    showCount(null);
    drawStrip();
    if (active) active.term.focus();
    return true;
  }

  function runFind(how) {
    if (!find || !active) return;
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

  // Dokunmatik cihazda Ctrl gibi tuslar tarayiciya ya da klavye katmanina takiliyor;
  // Android'de Ctrl+C sayfaya hic ulasmayabiliyor. Bu serit klavyeden bagimsiz:
  // dogrudan denetim dizisini PTY'ye yaziyor. Fare/trackpad varsa gizli duruyor.
  const KEYS = [
    ['esc', '\x1b'], ['tab', '\t'], ['^C', '\x03'], ['^D', '\x04'], ['^Z', '\x1a'],
    ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'],
  ];

  let keyWrap = null;

  function buildKeys() {
    const wrap = document.createElement('div');
    wrap.className = 'tm-keywrap' + (localStorage.getItem('cc.termKeys') === '0' ? ' off' : '');

    const tog = document.createElement('button');
    tog.className = 'tm-keytoggle';
    tog.textContent = '⌨';
    tog.title = T2('termKeys');
    tog.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      wrap.classList.toggle('off');
      localStorage.setItem('cc.termKeys', wrap.classList.contains('off') ? '0' : '1');
    });

    const bar = document.createElement('div');
    bar.className = 'tm-keys';
    const ekle = (ad, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = ad;
      if (cls) b.className = cls;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); if (active) active.term.focus(); });
      bar.appendChild(b);
    };

    for (const [ad, dizi] of KEYS) ekle(ad, () => { if (active) T.write(active.id, dizi); });

    // Dokunmatikte metin secip kopyalamak zor; acik dugme daha guvenilir.
    // Clipboard API guvenli baglam istiyor — localhost tunelinde saglaniyor.
    ekle('kopyala', async () => {
      if (!active) return;
      const sel = active.term.getSelection();
      if (sel) { try { await navigator.clipboard.writeText(sel); } catch {} }
    }, 'wide');
    ekle('yapıştır', async () => {
      if (!active) return;
      try { const t = await navigator.clipboard.readText(); if (t) T.write(active.id, t); } catch {}
    }, 'wide');
    // Tarayici yakinlastirmasi terminale gecmiyor; xterm'in kendi boyutu.
    ekle('A−', () => setFont(-1));
    ekle('A+', () => setFont(1));

    wrap.append(tog, bar);
    keyWrap = wrap;
    return wrap;
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

  async function open(cwd, command, resumeSessionId) {
    if (!panes) return;
    // Ayni klasorde ikinci bir terminal (ikinci bir Claude sureci) ayni dosyalari
    // ayni anda degistirmeye kalkabilir. Ozel bir sey istenmediyse ve o klasor
    // icin zaten acik bir sekme varsa, yenisini acmak yerine ona geciyoruz.
    // Resume bunun disinda: belirli bir konusmaya donmek istenmis, mevcut
    // sekmeye atlamak o istegi sessizce yutardi.
    if (!command && !resumeSessionId) {
      const existing = tabs.find((t) => t.cwd === cwd && !t.dead);
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
    // Ctrl/Cmd+V: xterm bunu kendi tusuna gore islemiyor, tarayicinin "paste"
    // olayina biraktigi icin bazi ortamlarda (Electron izin istemi vb.) hic
    // calismiyordu. Native panoyu dogrudan okuyup elle yapistiriyoruz.
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
      return true;
    });

    let info;
    try {
      // light: acik temada pty.js claude'u --settings '{"theme":"light"}' ile
      // aciyor, yoksa Claude Code koyu tema renklerini krem zemine basiyor.
      info = await T.create({
        cwd, cols: term.cols, rows: term.rows, command, resumeSessionId,
        light: !!cssVar('--term-light', ''),
      });
    } catch (e) {
      term.write('\r\n  terminal acilamadi: ' + String(e.message || e) + '\r\n');
      return;
    }

    const t = { ...info, term, fit, search, el, dead: false };
    // Sayac yalniz etkin sekme icin: izgarada digerlerinden gelen sonuc ustune yazmasin
    search.onDidChangeResults((r) => { if (t === active) showCount(r); });
    // Bazi tarayicilar Ctrl+C'yi "kopyala" diye yorumlayip terminale hic vermiyor.
    // Secim varken kopyalamak dogru davranis; secim yokken ^C gitmesi gerekiyor.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && !e.metaKey && !e.altKey
          && (e.key === 'c' || e.key === 'C') && !term.hasSelection()) {
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
    tabs.push(t);
    saveRestore();
    applyLayout();
    select(t);
    term.focus();
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
    requestAnimationFrame(() => { fitAll(); if (find && !find.box.hidden) find.input.focus(); else t.term.focus(); });
  }

  function selectIndex(i) {
    const t = tabs[i];
    if (t) select(t);
  }

  function close(t) {
    if (t.ro) t.ro.disconnect();
    T.kill(t.id);
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
    if (t) t.term.write(data);
  });
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
      if (t.dead) continue;
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
    // Panel bir session'in tty'sini biliyor: bu sekmelerden biri mi?
    tabForTty: (tty) => (tty ? (tabs.find((t) => t.tty === tty) || null) : null),
    // Panel bir sekmede hangi oturumun kostugunu biliyor; geri yuklemede
    // `--resume <id>` diyebilmek icin onu sekmeye yaziyoruz.
    // Ofiste el kaldiran kisi neyse, sekmede amber baslik o: bu sekmedeki
    // oturum senden input bekliyor.
    noteWaiting: (tty, waiting) => {
      const t = tabs.find((x) => x.tty === tty);
      if (t && !!t.waiting !== !!waiting) { t.waiting = !!waiting; drawStrip(); }
    },
    noteSession: (tty, sessionId) => {
      const t = tabs.find((x) => x.tty === tty);
      if (t && sessionId && t.sessionId !== sessionId) { t.sessionId = sessionId; saveRestore(); }
    },
    pendingCount: () => pending.length,
    list: () => tabs.map((t) => ({ id: t.id, cwd: t.cwd, title: t.title, tty: t.tty, dead: t.dead })),
    selectById: (id) => { const t = tabs.find((x) => x.id === id); if (t) select(t); return !!t; },
    showKeys: (on) => { if (keyWrap) keyWrap.classList.toggle('on', !!on); },
    conn: () => (T.state ? T.state() : { kind: T.kind }),
    count: () => tabs.length,
    layout: () => layout,
    setLayout,
    setTasksOpen: (v) => { tasksOpen = !!v; if (strip) drawStrip(); },
    fit: fitAll,
    retheme: () => {
      // Sira onemli: kontrast orani on plan renklerini zemine gore hesapliyor,
      // o yuzden once yeni zemin/palet girsin.
      for (const t of tabs) {
        t.term.options.theme = theme();
        t.term.options.minimumContrastRatio = minContrast();
      }
    },
  };
  window.dispatchEvent(new Event('mterm-ready'));
}
