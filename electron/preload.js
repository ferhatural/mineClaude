'use strict';
// Sayfa ile main surec arasindaki tum kopru bu kadar: tray'e sayi gonder, pencereyi one al.
// index.html bunun varligina bakip masaustunde oldugunu anliyor (service worker'i atlamak icin).
//
// UZAK kip: pencere baska bir makinedeki mineClaude'u yukluyor (Ayarlar > Sunucu).
// O zaman `term` koprusunu BILEREK vermiyoruz — term.js'de tek satir karar veriyor:
//     const T = D && D.term ? electronTransport(D.term) : webTransport();
// kopru yoksa WebSocket'e dusuyor ve PTY'ler uzak sunucunun havuzundan geliyor.
// Ayni sebeple focusTerminal da yok: oradaki tty bu makinede bir pencereye denk
// gelmiyor, "odakla" dugmesi yanlis uygulamayi one getirirdi.

const { contextBridge, ipcRenderer } = require('electron');

const UZAK = process.argv.includes('--mineclaude-remote');

const kopru = {
  setStatus: (s) => ipcRenderer.send('mineclaude:status', s),
  show: () => ipcRenderer.send('mineclaude:show'),

  // Hangi sunucuya bagliyiz — sayfa isterse gosterebilsin diye.
  remote: UZAK,

  // Ayarlar penceresindeki "Sunucu adresi > Degistir" satiri. Uzak kipte de
  // duruyor, yoksa yerele donmenin tek yolu menu cubugu olurdu.
  server: {
    change: () => ipcRenderer.send('mineclaude:server-change'),
  },

  // Pano her zaman BU makinenin panosu, sunucu nerede olursa olsun. Uzak kipte
  // `term` kaldirildigi icin okuyucuyu ayrica ust seviyede veriyoruz.
  // Uzak kipte gorsel dosya olarak degil bayt olarak geliyor (bkz. main.js).
  clipboard: {
    read: () => ipcRenderer.invoke('mineclaude:clipboard-read', { bytes: UZAK }),
  },

  // ⌘W: sayfa "su an terminal kapatilmali" durumunu onceden bildiriyor, ana surec
  // menude ona gore davraniyor. Sormak yerine bildirmek, iki dunyanin arasindaki
  // ayrimi hic kurcalamamak demek.
  setCloseIntercept: (on) => ipcRenderer.send('mineclaude:close-intercept', !!on),
  onCloseTerminal: (fn) => ipcRenderer.on('mineclaude:close-terminal', () => fn()),

  // Ayarlar > Dil ile Pencere > Dil ayni ayari paylasiyor: main surec tek kaynak.
  lang: {
    get: () => ipcRenderer.invoke('mineclaude:get-lang'),
    set: (l) => ipcRenderer.send('mineclaude:set-lang', l),
    onChange: (fn) => ipcRenderer.on('mineclaude:lang-changed', (_e, l) => fn(l)),
  },

  // Tema Ayarlar > Tema'dan (veya sistem temasi) degisince sayfa xterm
  // renklerini de yeniden boyamak icin bunu dinliyor (bkz. MTerm.retheme()).
  theme: {
    onChange: (fn) => ipcRenderer.on('mineclaude:theme-changed', () => fn()),
  },

  // Tarayici sekmesi (bkz. browser.js): yeni sekme isteyen linkler ve webview
  // icinde yakalanan kisayollar (wcId: hangi webview'den geldigi).
  web: {
    onOpen: (fn) => ipcRenderer.on('mineclaude:web-open', (_e, m) => fn(m)),
    onKey: (fn) => ipcRenderer.on('mineclaude:web-key', (_e, m) => fn(m)),
  },

  // Otomatik guncelleme indirilip hazir olunca sayfanin kendi modalini gostermesi icin.
  update: {
    onReady: (fn) => ipcRenderer.on('mineclaude:update-ready', (_e, info) => fn(info)),
    restart: () => ipcRenderer.send('mineclaude:update-restart'),
  },
};

if (!UZAK) {
  // { tty, host } -> { ok, app?, tabless? }
  kopru.focusTerminal = (s) => ipcRenderer.invoke('mineclaude:focus-terminal', s);

  // gomulu terminaller (yalniz yerel sunucu kipinde)
  kopru.term = {
    available: () => ipcRenderer.invoke('mineclaude:term-available'),
    create: (opt) => ipcRenderer.invoke('mineclaude:term-create', opt),
    list: () => ipcRenderer.invoke('mineclaude:term-list'),
    write: (id, data) => ipcRenderer.send('mineclaude:term-write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('mineclaude:term-resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.send('mineclaude:term-kill', { id }),
    pickFolder: () => ipcRenderer.invoke('mineclaude:pick-folder'),
    readClipboard: () => ipcRenderer.invoke('mineclaude:clipboard-read'),
    onData: (fn) => ipcRenderer.on('mineclaude:term-data', (_e, m) => fn(m)),
    onExit: (fn) => ipcRenderer.on('mineclaude:term-exit', (_e, m) => fn(m)),
  };
}

contextBridge.exposeInMainWorld('mineClaudeDesktop', kopru);

// Ayarlar > Sunucu > "Sunucu ekle…" penceresi. Ayri bir preload yazmak yerine
// ayni dosyada, argv bayragiyla ayriliyor (bkz. --mineclaude-remote).
if (process.argv.includes('--mineclaude-prompt')) {
  contextBridge.exposeInMainWorld('mineClaudePrompt', {
    init: () => ipcRenderer.invoke('mineclaude:prompt-init'),
    submit: (v) => ipcRenderer.send('mineclaude:prompt-submit', v),
    cancel: () => ipcRenderer.send('mineclaude:prompt-cancel'),
  });
}
