'use strict';
// Sayfa ile main surec arasindaki tum kopru bu kadar: tray'e sayi gonder, pencereyi one al.
// index.html bunun varligina bakip masaustunde oldugunu anliyor (service worker'i atlamak icin).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mineClaudeDesktop', {
  setStatus: (s) => ipcRenderer.send('mineclaude:status', s),
  show: () => ipcRenderer.send('mineclaude:show'),
  // { tty, host } -> { ok, app?, tabless? }
  focusTerminal: (s) => ipcRenderer.invoke('mineclaude:focus-terminal', s),

  // gomulu terminaller
  term: {
    available: () => ipcRenderer.invoke('mineclaude:term-available'),
    create: (opt) => ipcRenderer.invoke('mineclaude:term-create', opt),
    write: (id, data) => ipcRenderer.send('mineclaude:term-write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('mineclaude:term-resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.send('mineclaude:term-kill', { id }),
    pickFolder: () => ipcRenderer.invoke('mineclaude:pick-folder'),
    readClipboard: () => ipcRenderer.invoke('mineclaude:clipboard-read'),
    onData: (fn) => ipcRenderer.on('mineclaude:term-data', (_e, m) => fn(m)),
    onExit: (fn) => ipcRenderer.on('mineclaude:term-exit', (_e, m) => fn(m)),
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
});
