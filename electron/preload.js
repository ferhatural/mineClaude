'use strict';
// Sayfa ile main surec arasindaki tum kopru bu kadar: tray'e sayi gonder, pencereyi one al.
// index.html bunun varligina bakip masaustunde oldugunu anliyor (service worker'i atlamak icin).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mineClaudeDesktop', {
  setStatus: (s) => ipcRenderer.send('mineclaude:status', s),
  show: () => ipcRenderer.send('mineclaude:show'),
  // { tty, host } -> { ok, app?, tabless? }
  focusTerminal: (s) => ipcRenderer.invoke('mineclaude:focus-terminal', s),
});
