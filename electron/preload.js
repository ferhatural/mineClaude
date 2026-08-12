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
    onData: (fn) => ipcRenderer.on('mineclaude:term-data', (_e, m) => fn(m)),
    onExit: (fn) => ipcRenderer.on('mineclaude:term-exit', (_e, m) => fn(m)),
  },

  // ⌘W: sayfa "su an terminal kapatilmali" durumunu onceden bildiriyor, ana surec
  // menude ona gore davraniyor. Sormak yerine bildirmek, iki dunyanin arasindaki
  // ayrimi hic kurcalamamak demek.
  setCloseIntercept: (on) => ipcRenderer.send('mineclaude:close-intercept', !!on),
  onCloseTerminal: (fn) => ipcRenderer.on('mineclaude:close-terminal', () => fn()),
});
