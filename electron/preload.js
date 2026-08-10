'use strict';
// Sayfa ile main surec arasindaki tum kopru bu kadar: tray'e sayi gonder, pencereyi one al.
// index.html bunun varligina bakip masaustunde oldugunu anliyor (service worker'i atlamak icin).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccwatchDesktop', {
  setStatus: (s) => ipcRenderer.send('ccwatch:status', s),
  show: () => ipcRenderer.send('ccwatch:show'),
});
