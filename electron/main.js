'use strict';
// mineClaude'in macOS menu bar uygulamasi.
//
// Yaptigi is uc parca:
//   1) server.js'i cocuk surec olarak ayakta tutar (zaten calisan bir mineClaude varsa onu benimser)
//   2) menu barda bir ikon gosterir; input bekleyen session varsa amber olur ve sayiyi yazar
//   3) ikona basinca ayni tek pencereyi acar/kapatir. Pencere kapatilinca uygulama olmez, gizlenir.
//
// Dock'ta ikon yok (LSUIElement). Cikis tray menusunden ya da Cmd+Q ile.

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, screen, dialog, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const term = require('../pty');

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
let closeIntercept = false;   // sayfa: terminal gorunumunde ve acik terminal var
let quitConfirmed = false;    // "hepsi kapanacak" sorusu onaylandi mi

// Menuler ve dialoglar isletim sisteminin diline uyuyor. Electron'un hazir menu
// rolleri (Minimize, Zoom, Reload...) macOS'ta boyle geliyor; Windows'ta ise
// role etiketleri hep Ingilizce kaliyor (Edit dahil), o yuzden Edit menusunu ve
// alt ogelerini kendimiz etiketliyoruz. Panelin TR/EN anahtari icerigi
// ilgilendiriyor, pencere kromunu degil — cogu uygulamada boyle.
//
// app.getLocale() Windows'ta yalnizca 'ready' olayindan sonra dogru sonuc
// veriyor (Electron'un kendi notu) — bu yuzden TR/L'yi dosya basinda degil,
// initL() ile ready sonrasi hesapliyoruz.
let TR;
let L;
function initL() {
  TR = config.lang ? config.lang === 'tr' : /^tr/i.test(app.getLocale() || '');
  L = {
  show:      TR ? 'mineClaude’i aç'        : 'Open mineClaude',
  hide:      TR ? 'Pencereyi gizle'        : 'Hide window',
  browser:   TR ? 'Tarayıcıda aç'          : 'Open in browser',
  reload:    TR ? 'Yenile'                 : 'Reload',
  atLogin:   TR ? 'Açılışta başlat'        : 'Start at login',
  server:    TR ? 'Sunucu'                 : 'Server',
  external:  TR ? 'dışarıdan'              : 'external',
  quit:      TR ? 'mineClaude’ten çık'     : 'Quit mineClaude',
  editMenu:  TR ? 'Düzenle'                : 'Edit',
  undo:      TR ? 'Geri al'                : 'Undo',
  redo:      TR ? 'Yinele'                 : 'Redo',
  cut:       TR ? 'Kes'                    : 'Cut',
  copy:      TR ? 'Kopyala'                : 'Copy',
  paste:     TR ? 'Yapıştır'               : 'Paste',
  pasteStyle:TR ? 'Yapıştır ve Stili Eşleştir' : 'Paste and Match Style',
  delete:    TR ? 'Sil'                    : 'Delete',
  selectAll: TR ? 'Tümünü seç'             : 'Select All',
  viewMenu:  TR ? 'Görünüm'                : 'View',
  forceReload: TR ? 'Yeniden yükle (zorla)': 'Force Reload',
  devTools:  TR ? 'Geliştirici Araçları'   : 'Toggle Developer Tools',
  actualSize:TR ? 'Gerçek Boyut'           : 'Actual Size',
  zoomIn:    TR ? 'Yakınlaştır'            : 'Zoom In',
  zoomOut:   TR ? 'Uzaklaştır'             : 'Zoom Out',
  fullscreen:TR ? 'Tam Ekran'              : 'Toggle Full Screen',
  winMenu:   TR ? 'Pencere'                : 'Window',
  minimize:  TR ? 'Simge durumuna küçült'  : 'Minimize',
  winZoom:   TR ? 'Pencereyi büyüt'        : 'Zoom',
  close:     TR ? 'Kapat'                  : 'Close',
  settingsMenu: TR ? 'Ayarlar'             : 'Settings',
  langMenu:  TR ? 'Dil'                    : 'Language',
  langSystem:TR ? 'Sistem (varsayılan)'    : 'System (default)',
  themeMenu: TR ? 'Tema'                   : 'Theme',
  themeSystem: TR ? 'Sistem (varsayılan)'  : 'System (default)',
  themeLight:TR ? 'Açık'                   : 'Light',
  themeDark: TR ? 'Koyu'                   : 'Dark',
  helpMenu:  TR ? 'Yardım'                 : 'Help',
  about:     TR ? 'Hakkında'               : 'About',
  aboutDetail: (v) => (TR
    ? `Sürüm ${v}\n\nYerel Claude Code oturumların için bir kontrol paneli.`
    : `Version ${v}\n\nA local dashboard for your Claude Code sessions.`),
  aboutGitHub: TR ? "GitHub'da aç"          : 'Open on GitHub',
  ok:        TR ? 'Tamam'                  : 'OK',
  pickDir:   TR ? 'Terminal hangi klasörde açılsın?' : 'Which folder should the terminal open in?',
  qButtons:  TR ? ['Çık', 'Vazgeç']        : ['Quit', 'Cancel'],
  qDetail:   TR ? 'İçlerinde çalışan Claude oturumları da kapanır.'
                : 'The Claude sessions running in them close too.',
  qMessage:  (n) => (TR
    ? `${n} terminal açık — hepsi kapanacak`
    : `${n} terminal${n > 1 ? 's are' : ' is'} open — all of them will close`),
  updateTitle:   TR ? 'Güncelleme hazır'      : 'Update ready',
  updateMessage: (v) => (TR
    ? `mineClaude ${v} indirildi. Şimdi yeniden başlatıp kurulsun mu?`
    : `mineClaude ${v} has been downloaded. Restart now to install it?`),
  updateRestart: TR ? 'Şimdi yeniden başlat'  : 'Restart now',
  updateLater:   TR ? 'Sonra'                 : 'Later',
  };
}

// ---------------------------------------------------------------- ayarlar

const configFile = () => path.join(app.getPath('userData'), 'config.json');
// lang: null = sistemin diline uy, 'tr'/'en' = kullanicinin Ayarlar > Dil'den sectigi zorlama.
// theme: null = sistemin temasina uy, 'light'/'dark' = Ayarlar > Tema'dan secilen zorlama.
// lastTermDir: yeni terminal icin klasor secme diyalogu en son nereden secildiyse
// orada acilsin diye — Windows'ta bu diyalog kendiliginden hatirlamiyor.
const config = { port: DEFAULT_PORT, bounds: null, lang: null, theme: null, lastTermDir: null };

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

// Dock ikonu her zaman duruyor (LSUIElement kapali). Uygulama pencere gizliyken de
// Cmd+Tab listesinde: tray'e cekilmis bir pencereye klavyeden donebilmek, dock'ta bir
// ikon tasimaya degiyor. Dock ikonuna tiklamak pencereyi geri getiriyor (app 'activate').
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
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
    { label: open ? L.hide : L.show, click: toggleWindow },
    { label: L.browser, click: () => shell.openExternal(serverUrl) },
    { type: 'separator' },
    {
      label: L.reload,
      click: () => win && !win.isDestroyed() && win.webContents.reload(),
    },
    {
      label: L.atLogin,
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: 'separator' },
    {
      label: `${L.server}: localhost:${config.port}` + (child ? '' : ` (${L.external})`),
      enabled: false,
    },
    { type: 'separator' },
    { label: L.quit, accelerator: 'Command+Q', click: () => app.quit() },
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

// Dil, Ayarlar > Dil menusunden seciliyor ve config.json'a yaziliyor; sayfa da
// bunu IPC ile dinleyip kendi metnini ayni dile cekiyor (bkz preload.js: lang.onChange).
function applyLangOverride(newLang, notifyPage = true) {
  if (config.lang === newLang) return;
  config.lang = newLang;
  saveConfig();
  initL();
  setAppMenu();
  if (notifyPage && win && !win.isDestroyed()) {
    win.webContents.send('mineclaude:lang-changed', TR ? 'tr' : 'en');
  }
}

// Tema Ayarlar > Tema'dan seciliyor. nativeTheme.themeSource'u degistirmek hem native
// pencere/diyalog renklerini hem de sayfadaki (index.html) prefers-color-scheme
// medya sorgusunu otomatik guncelliyor — sayfa tarafinda ekstra kod gerekmiyor.
function applyThemeOverride(newTheme) {
  if (config.theme === newTheme) return;
  config.theme = newTheme;
  saveConfig();
  nativeTheme.themeSource = newTheme || 'system';
  setAppMenu();
}

// Sayfa nativeTheme degisince prefers-color-scheme uzerinden kendi renklerini
// otomatik guncelliyor, ama terminal (xterm) renkleri acilista bir kere
// okunup sabitleniyor — tema degisince sayfaya haber verip xterm'i de
// yeniden boyatmasini istiyoruz (bkz. index.html: MTerm.retheme()).
function notifyThemeChanged() {
  if (win && !win.isDestroyed()) win.webContents.send('mineclaude:theme-changed');
}
nativeTheme.on('updated', notifyThemeChanged);

function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    // appMenu (uygulama adiyla acilan ilk menu: About/Hide/Quit) sadece macOS'ta bir
    // sey gosteriyor. Windows'ta zaten bomboş acılıyor, sadece kucuk harfli "mineclaude"
    // yazan cirkin bir etiket olarak kalıyor — o yuzden orada hic eklemiyoruz.
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: L.editMenu,
      submenu: [
        { role: 'undo', label: L.undo },
        { role: 'redo', label: L.redo },
        { type: 'separator' },
        { role: 'cut', label: L.cut },
        { role: 'copy', label: L.copy },
        { role: 'paste', label: L.paste },
        ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle', label: L.pasteStyle }] : []),
        { role: 'delete', label: L.delete },
        { type: 'separator' },
        { role: 'selectAll', label: L.selectAll },
      ],
    },
    {
      label: L.viewMenu,
      submenu: [
        { role: 'reload', label: L.reload },
        { role: 'forceReload', label: L.forceReload },
        { role: 'toggleDevTools', label: L.devTools },
        { type: 'separator' },
        { role: 'resetZoom', label: L.actualSize },
        { role: 'zoomIn', label: L.zoomIn },
        { role: 'zoomOut', label: L.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L.fullscreen },
      ],
    },
    {
      label: L.winMenu,
      submenu: [
        { role: 'minimize', label: L.minimize },
        { role: 'zoom', label: L.winZoom },
        // ⌘W varsayilan olarak pencereyi kapatiyor (bizde: gizliyor). Terminal
        // gorunumundeyken beklenen sey etkin terminali kapatmak. Karari sayfa
        // veriyor: terminal kapattiysa 'true' donuyor, yoksa pencereyi gizliyoruz.
        {
          label: L.close,
          accelerator: 'Command+W',
          click: () => {
            if (!win || win.isDestroyed()) return;
            // Sayfa "terminal gorunumundeyim ve acik terminalim var" diye onceden
            // haber veriyor; burada sormuyoruz. executeJavaScript ile sormak
            // calismiyordu: contextIsolation acikken preload'un window'u ile
            // sayfanin window'u ayri dunyalar, kanca gorunmuyor.
            if (closeIntercept) win.webContents.send('mineclaude:close-terminal');
            else win.hide();
          },
        },
      ],
    },
    {
      label: L.settingsMenu,
      submenu: [
        {
          label: L.themeMenu,
          submenu: [
            { label: L.themeSystem, type: 'radio', checked: !config.theme, click: () => applyThemeOverride(null) },
            { label: L.themeLight, type: 'radio', checked: config.theme === 'light', click: () => applyThemeOverride('light') },
            { label: L.themeDark, type: 'radio', checked: config.theme === 'dark', click: () => applyThemeOverride('dark') },
          ],
        },
        {
          label: L.langMenu,
          submenu: [
            { label: L.langSystem, type: 'radio', checked: !config.lang, click: () => applyLangOverride(null) },
            { label: 'Türkçe', type: 'radio', checked: config.lang === 'tr', click: () => applyLangOverride('tr') },
            { label: 'English', type: 'radio', checked: config.lang === 'en', click: () => applyLangOverride('en') },
          ],
        },
      ],
    },
    {
      label: L.helpMenu,
      submenu: [
        {
          label: L.about,
          click: () => showAbout(),
        },
      ],
    },
  ]));
}

function showAbout() {
  const v = app.getVersion();
  dialog.showMessageBox(win, {
    type: 'info',
    title: L.about,
    message: 'mineClaude',
    detail: L.aboutDetail(v),
    buttons: [L.ok, L.aboutGitHub],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).then((r) => {
    if (r.response === 1) shell.openExternal('https://github.com/ferhatural/mineClaude');
  });
}

// ---------------------------------------------------------------- otomatik guncelleme
//
// package.json > build.publish, GitHub Releases'i kaynak gosteriyor (fork'un).
// Yeni bir surum orada yayinlandiginda (electron-builder --publish always ile)
// buradaki her kurulu kopya acilista ve sonra periyodik olarak kontrol edip
// indiriyor, kullaniciya sorup onay alinca yeniden baslatip kuruyor.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // gelistirme sirasinda (npm run app) anlamsiz, hata basar
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: L.updateTitle,
      message: L.updateMessage(info.version),
      buttons: [L.updateRestart, L.updateLater],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', (err) => {
    console.error('[mineClaude] guncelleme kontrolu basarisiz:', err.message || err);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 3600e3); // uygulama uzun sure acik kalabiliyor: 4 saatte bir tekrar bak
}

// ---------------------------------------------------------------- giris

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    loadConfig();
    initL();
    if (config.theme) nativeTheme.themeSource = config.theme;
    // Dock'u burada gizlemiyoruz: acilista showWindow() zaten gosterecek ve pesi sira
    // gelen hide()/show() cifti AppKit'te birbirini yiyor. Gizleme isi pencere
    // kapandiginda (win 'hide') oluyor.
    setAppMenu();
    createTray();

    const port = await ensureServer();
    serverUrl = `http://127.0.0.1:${port}`;
    createWindow();
    showWindow(); // ilk acilista pencereyi goster; sonraki acilislar tray'den
    setupAutoUpdate();
  });

  ipcMain.on('mineclaude:status', (_e, s) => setTrayStatus(s || {}));
  ipcMain.on('mineclaude:show', showWindow);
  ipcMain.handle('mineclaude:focus-terminal', (_e, s) => focusTerminal(s || {}));

  // ---- gomulu terminaller
  ipcMain.handle('mineclaude:term-available', () => ({ ok: term.available(), error: term.loadError() }));
  ipcMain.handle('mineclaude:term-create', (e, opt) => {
    const info = term.create(opt || {});
    const wc = e.sender;
    term.attach(
      info.id,
      (id, data) => { if (!wc.isDestroyed()) wc.send('mineclaude:term-data', { id, data }); },
      (id, code) => { if (!wc.isDestroyed()) wc.send('mineclaude:term-exit', { id, code }); },
    );
    return info;
  });
  ipcMain.on('mineclaude:term-write', (_e, { id, data }) => term.write(id, data));
  ipcMain.on('mineclaude:term-resize', (_e, { id, cols, rows }) => term.resize(id, cols, rows));
  ipcMain.on('mineclaude:term-kill', (_e, { id }) => term.kill(id));
  ipcMain.on('mineclaude:close-intercept', (_e, on) => { closeIntercept = !!on; });
  ipcMain.handle('mineclaude:get-lang', () => (config.lang === 'tr' || config.lang === 'en' ? config.lang : null));
  ipcMain.on('mineclaude:set-lang', (_e, l) => applyLangOverride(l === 'tr' || l === 'en' ? l : null, false));
  ipcMain.handle('mineclaude:pick-folder', async () => {
    const opts = { properties: ['openDirectory'], message: L.pickDir };
    if (config.lastTermDir) opts.defaultPath = config.lastTermDir;
    const r = await dialog.showOpenDialog(win, opts);
    if (r.canceled) return null;
    // Secilen klasorun kendisini degil bir ustunu hatirliyoruz: ayni klasorde
    // (ornegin ~/Projects) baska bir proje daha secmek isteyince oradan
    // basliyor, secilenin icine gomulu kalmiyor.
    config.lastTermDir = path.dirname(r.filePaths[0]);
    saveConfig();
    return r.filePaths[0];
  });
  // Gomulu terminalde Ctrl/Cmd+V: navigator.clipboard.readText() Electron'da izin
  // istegine takilabiliyor, dogrudan native panoyu okumak her zaman calisiyor.
  // Panoda metin yoksa (ekran goruntusu gibi bir gorsel varsa) onu gecici bir
  // PNG dosyasina kaydedip yolunu donuyoruz — Claude Code mesajda gecen bir
  // gorsel dosya yolunu kendisi tanıyip ekliyor.
  ipcMain.handle('mineclaude:clipboard-read', () => {
    const text = clipboard.readText();
    if (text) return { text, imagePath: null };
    const image = clipboard.readImage();
    if (image.isEmpty()) return { text: '', imagePath: null };
    const dir = path.join(os.tmpdir(), 'mineclaude-paste');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `paste-${Date.now()}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { text: '', imagePath: file };
  });

  app.on('activate', showWindow);
  app.on('window-all-closed', () => { /* menu bar uygulamasi: pencere yoksa da yasar */ });
  // Cikista acik terminal varsa once sor. PTY'ler bu surecte yasadigi icin ⌘Q
  // hepsini birden goturuyor — icindeki Claude oturumlariyla beraber. Mimariyi
  // buyutup PTY'leri ayri bir surece tasimak yerine, once haber veriyoruz.
  app.on('before-quit', (e) => {
    const live = term.list().filter((t) => !t.dead);
    if (!quitConfirmed && live.length) {
      e.preventDefault();
      const opts = {
        type: 'warning',
        buttons: L.qButtons,
        defaultId: 1,           // varsayilan vazgecmek: yanlislikla ⌘Q'ya basmak ucuz olmasin
        cancelId: 1,
        message: L.qMessage(live.length),
        detail: L.qDetail + '\n\n' + live.map((t) => '· ' + t.title).join('\n'),
      };
      const shown = win && !win.isDestroyed() && win.isVisible()
        ? dialog.showMessageBox(win, opts)
        : (app.focus({ steal: true }), dialog.showMessageBox(opts));
      Promise.resolve(shown).then((r) => {
        if (r && r.response === 0) { quitConfirmed = true; app.quit(); }
      });
      return;
    }
    quitting = true;
    term.killAll();          // acik terminaller uygulamayla birlikte kapanir
    if (child) child.kill();
  });
}
