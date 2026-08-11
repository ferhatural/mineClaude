'use strict';
// mineClaude'in macOS menu bar uygulamasi.
//
// Yaptigi is uc parca:
//   1) server.js'i cocuk surec olarak ayakta tutar (zaten calisan bir mineClaude varsa onu benimser)
//   2) menu barda bir ikon gosterir; input bekleyen session varsa amber olur ve sayiyi yazar
//   3) ikona basinca ayni tek pencereyi acar/kapatir. Pencere kapatilinca uygulama olmez, gizlenir.
//
// Dock'ta ikon yok (LSUIElement). Cikis tray menusunden ya da Cmd+Q ile.

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER_JS = path.join(ROOT, 'server.js');
const ASSETS = path.join(__dirname, 'assets');
const DEFAULT_PORT = parseInt(process.env.MINECLAUDE_PORT || '7788', 10);

let tray = null;
let win = null;
let child = null;         // bizim baslattigimiz server (baskasininkini benimsediysek null)
let serverUrl = null;
let quitting = false;
let restarts = 0;

// ---------------------------------------------------------------- ayarlar

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const config = { port: DEFAULT_PORT, bounds: null };

function loadConfig() {
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(configFile(), 'utf8')));
  } catch { /* ilk acilis */ }
}

let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(configFile()), { recursive: true });
      fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
    } catch { /* yazamazsak ayarlar ucar, uygulama calismaya devam eder */ }
  }, 400);
}

// ---------------------------------------------------------------- sunucu

// Portta bir sey var mi, varsa mineClaude mi? Sonuc: null | { version }
function probeMineClaude(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 4 * 1024 * 1024) req.destroy();
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(Array.isArray(j.live) ? { version: j.version || null } : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function findFreePort(from) {
  for (let p = from; p < from + 40; p++) if (await portFree(p)) return p;
  return 0; // isletim sistemi secsin diyemiyoruz, server.js sabit port bekliyor
}

function spawnServer(port) {
  // Paketlenmis uygulamada `node` olmayabilir; Electron'un kendi binary'sini
  // saf Node olarak calistiriyoruz.
  child = spawn(process.execPath, [SERVER_JS, '--port', String(port), '--no-open'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MINECLAUDE_SUPERVISED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (b) => process.stderr.write('[mineClaude server] ' + b));
  child.on('exit', (code) => {
    child = null;
    if (quitting) return;
    if (restarts++ < 3) {
      setTimeout(() => spawnServer(port), 1500);
    } else {
      setTrayStatus({ down: true });
    }
  });
}

function waitUntilUp(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probeMineClaude(port)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function ensureServer() {
  // Once alisilmis port: orada calisan bir mineClaude varsa (launchd ile kurulmus olabilir)
  // ikinci bir sunucu acmanin anlami yok — ama yalniz surumu bizimkiyle ayniysa.
  // Gunlerdir ayakta duran bir servis, repo guncellenince eski index.html'i ve artik
  // var olan ama onun bilmedigi dosyalari servis etmeye devam ediyor; oyle bir sunucuyu
  // benimsemek "3D gorunum bazen var bazen yok" demek.
  const found = await probeMineClaude(DEFAULT_PORT);
  if (found && found.version === app.getVersion()) return DEFAULT_PORT;
  if (found) {
    console.error(
      `[mineClaude] ${DEFAULT_PORT} portunda eski bir mineClaude var (surum ${found.version || 'bilinmiyor'}), ` +
      `bizimki ${app.getVersion()} — benimsemek yerine kendi sunucumuzu aciyoruz.`,
    );
  }

  // Kendimiz kuruyoruz: once alisilmis port, dolsuysa gecen seferki, o da olmazsa bos bir tane.
  let port = 0;
  for (const cand of [DEFAULT_PORT, config.port, 0]) {
    if (cand && (await portFree(cand))) { port = cand; break; }
    if (cand === 0) port = await findFreePort(DEFAULT_PORT + 1);
  }
  if (!port) port = DEFAULT_PORT; // hicbiri olmadi; server.js kendi hatasini bassin
  config.port = port;
  saveConfig();
  spawnServer(port);
  await waitUntilUp(port, 15000);
  return port;
}

// ---------------------------------------------------------------- pencere

function sanitizeBounds(b) {
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return null;
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return { width: b.width, height: b.height };
  // Ekran degistiyse pencere gorunmez bir kosede kalmasin.
  const area = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

function createWindow() {
  const saved = sanitizeBounds(config.bounds);
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 420,
    minHeight: 400,
    ...(saved || {}),
    show: false,
    title: 'mineClaude',
    backgroundColor: '#0e1013',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // gizliyken de SSE'yi dinlesin, bildirimler gecikmesin
      spellcheck: false,
    },
  });

  win.loadURL(serverUrl);

  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    config.bounds = win.getBounds();
    saveConfig();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('hide', () => syncDock(false));

  // Kirmizi dugme / Cmd+W uygulamayi kapatmaz: menu bar uygulamasi, arka planda kalir.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  // Disari giden linkler varsayilan tarayicida acilsin, pencerede degil.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(serverUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Dock ikonu pencere acikken var, kapaliyken yok. Boylece uygulama arka planda
// dururken yolda durmuyor ama pencere ortadayken Cmd+Tab ile ona gecebiliyorsun —
// LSUIElement acikken uygulama switcher'da hic gorunmuyordu.
function syncDock(visible) {
  if (!app.dock) return;
  if (visible) app.dock.show();
  else app.dock.hide();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  // Sira onemli: dock'u once acarsak aktivasyon politikasi accessory -> regular'a
  // gecerken az once gosterdigimiz pencereyi yutuyor. Once pencere, sonra dock.
  win.show();
  syncDock(true);
  win.focus();
  app.focus({ steal: true });
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

// ---------------------------------------------------------------- tray

const icon = (name) => {
  const img = nativeImage.createFromPath(path.join(ASSETS, name + '.png'));
  return img;
};

let ICON_IDLE = null;
let ICON_WAITING = null;

function createTray() {
  ICON_IDLE = icon('trayTemplate');
  ICON_IDLE.setTemplateImage(true); // acik/koyu menu barda sistem boyar
  ICON_WAITING = icon('trayWaiting');

  tray = new Tray(ICON_IDLE);
  tray.setToolTip('mineClaude');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

function buildMenu() {
  const open = !!(win && !win.isDestroyed() && win.isVisible());
  return Menu.buildFromTemplate([
    { label: open ? 'Pencereyi gizle' : 'mineClaude’i ac', click: toggleWindow },
    { label: 'Tarayicida ac', click: () => shell.openExternal(serverUrl) },
    { type: 'separator' },
    {
      label: 'Yenile',
      click: () => win && !win.isDestroyed() && win.webContents.reload(),
    },
    {
      label: 'Acilista baslat',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: 'separator' },
    {
      label: child ? `Sunucu: localhost:${config.port}` : `Sunucu: localhost:${config.port} (disaridan)`,
      enabled: false,
    },
    { type: 'separator' },
    { label: 'mineClaude’ten cik', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
}

// Sayimi renderer gonderiyor: sayfa zaten SSE dinliyor, ikinci bir polling'e gerek yok.
function setTrayStatus(s) {
  if (!tray || tray.isDestroyed()) return;
  if (s.down) {
    tray.setImage(ICON_IDLE);
    tray.setTitle('');
    tray.setToolTip('mineClaude — sunucuya baglanilamiyor');
    return;
  }
  const waiting = s.waiting | 0;
  const total = s.total | 0;
  tray.setImage(waiting ? ICON_WAITING : ICON_IDLE);
  tray.setTitle(waiting ? ' ' + waiting : '');
  tray.setToolTip(
    waiting
      ? `mineClaude — ${waiting} session input bekliyor (${total} acik)`
      : `mineClaude — ${total} session`,
  );
}

// ---------------------------------------------------------------- terminal sekmesine gitme

// Session'in tty'sini bilen bir terminal uygulamasi varsa o sekmeyi one getiriyoruz.
// Yeni sekme acmiyoruz: amac zaten acik olani bulmak.
//
// Terminal.app ve iTerm2'nin AppleScript sozluklerinde sekme/oturum basina `tty`
// var, eslestirme birebir. VS Code, Cursor, Ghostty, Warp gibi gomulu terminallerde
// sekme sectirecek bir arayuz yok; orada yapabilecegimiz en fazlasi uygulamayi one
// almak, cagiran taraf da bunu kullaniciya soyluyor.

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
    resolve({ ok: !err, out: String(stdout || '').trim() });
  });
});

// Uygulama calismiyorsa `tell application` onu baslatiyor. Sadece sekme aramak icin
// terminal acmayalim: once gercekten ayakta mi diye bakiyoruz.
async function appRunning(bundleFragment) {
  const { out } = await run('ps', ['-axo', 'comm=']);
  return out.split('\n').some((l) => l.includes(bundleFragment));
}

const TERMINAL_AS = (dev) => `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is ${JSON.stringify(dev)} then
        set selected of t to true
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "yok"`;

const ITERM_AS = (dev) => `
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is ${JSON.stringify(dev)} then
          select w
          select t
          select s
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "yok"`;

// host metni bir uygulama adina benziyorsa: sekmeyi bulamasak da uygulamayi one alalim
const HOST_APP = [
  [/VS ?Code|Visual Studio Code/i, 'Visual Studio Code'],
  [/Cursor/i, 'Cursor'],
  [/iTerm/i, 'iTerm'],
  [/Warp/i, 'Warp'],
  [/Ghostty/i, 'Ghostty'],
  [/Terminal/i, 'Terminal'],
];

async function focusTerminal({ tty, host }) {
  // tty renderer'dan geliyor ve AppleScript metnine giriyor: kaliba uymayani hic denemeyelim
  const dev = /^tty[a-z0-9]+$/.test(String(tty || '')) ? '/dev/' + tty : null;

  if (dev) {
    if (await appRunning('/Terminal.app/Contents/MacOS/Terminal')) {
      const r = await run('osascript', ['-e', TERMINAL_AS(dev)]);
      if (r.ok && r.out === 'ok') return { ok: true, app: 'Terminal' };
    }
    if (await appRunning('/iTerm.app/Contents/MacOS/iTerm2')) {
      const r = await run('osascript', ['-e', ITERM_AS(dev)]);
      if (r.ok && r.out === 'ok') return { ok: true, app: 'iTerm2' };
    }
  }

  const hit = HOST_APP.find(([re]) => re.test(String(host || '')));
  if (hit) {
    const r = await run('open', ['-a', hit[1]]);
    if (r.ok) return { ok: true, app: hit[1], tabless: true };
  }
  return { ok: false };
}

// ---------------------------------------------------------------- uygulama menusu

function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'Gorunum',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// ---------------------------------------------------------------- giris

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    loadConfig();
    // Dock'u burada gizlemiyoruz: acilista showWindow() zaten gosterecek ve pesi sira
    // gelen hide()/show() cifti AppKit'te birbirini yiyor. Gizleme isi pencere
    // kapandiginda (win 'hide') oluyor.
    setAppMenu();
    createTray();

    const port = await ensureServer();
    serverUrl = `http://127.0.0.1:${port}`;
    createWindow();
    showWindow(); // ilk acilista pencereyi goster; sonraki acilislar tray'den
  });

  ipcMain.on('mineclaude:status', (_e, s) => setTrayStatus(s || {}));
  ipcMain.on('mineclaude:show', showWindow);
  ipcMain.handle('mineclaude:focus-terminal', (_e, s) => focusTerminal(s || {}));

  app.on('activate', showWindow);
  app.on('window-all-closed', () => { /* menu bar uygulamasi: pencere yoksa da yasar */ });
  app.on('before-quit', () => {
    quitting = true;
    if (child) child.kill();
  });
}
