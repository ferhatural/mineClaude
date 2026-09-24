'use strict';
// Terminallerin yanindaki tarayici sekmesi (term.js openWeb) icin ana surec tarafi.
// Sayfa bir <webview>: kod beklerken internette gezinmek icin, uygulamadan cikmadan.
//
// Burada olan her sey webview'in "normal bir tarayici" gibi davranmasi icin:
//   - kalici, uygulamadan ayri bir oturum (girisler kalsin, panelin cerezleriyle karismasin)
//   - Electron/mineClaude izi olmayan user-agent (Google vb. "guvenli olmayan tarayici" demesin)
//   - yeni pencere isteyen linkler yeni sekmede
//   - sag tik menusu ve alisilmis kisayollar (Electron bunlarin hicbirini kendiliginden vermiyor)

const { session, Menu, shell, clipboard } = require('electron');

const PARTITION = 'persist:mineclaude-web';

let ready = false;
function setupSession() {
  if (ready) return;
  ready = true;
  const ses = session.fromPartition(PARTITION);
  // "... mineClaude/1.4.1 Chrome/x Electron/y Safari/z" -> duz Chrome
  ses.setUserAgent(ses.getUserAgent().replace(/\s(mineclaude|Electron)\/\S+/gi, ''));
  // Kamera/mikrofon/konum/bildirim sormadan verilmesin; gezinmek icin gerekenler kalsin.
  const allow = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allow.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allow.has(perm));
}

// win: ana pencere. tr(): menulerin dili (main.js'teki TR).
function attach(win, tr) {
  setupSession();
  const send = (ch, m) => { if (!win.isDestroyed()) win.webContents.send(ch, m); };

  // Gomulu sayfa yabanci kod: preload'u/node'u asla almasin, oturumu hep bizimki olsun.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    params.partition = PARTITION;
    if (!/^(https?:|about:blank)/i.test(params.src || '')) params.src = 'about:blank';
  });

  win.webContents.on('did-attach-webview', (_e, wc) => {
    // target=_blank / window.open: yeni sekme
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) send('mineclaude:web-open', { url });
      return { action: 'deny' };
    });

    // Kisayollar webview'in icinde yakalaniyor; sayfanin klavye olayi ust belgeye gelmiyor.
    wc.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return;
      const mod = process.platform === 'darwin' ? i.meta : i.control;
      const k = i.key.toLowerCase();
      let act = null;
      if (mod && k === 'l') act = 'focus-url';
      else if ((mod && k === 'r') || i.key === 'F5') act = 'reload';
      else if ((i.alt && i.key === 'ArrowLeft') || (mod && i.key === '[')) act = 'back';
      else if ((i.alt && i.key === 'ArrowRight') || (mod && i.key === ']')) act = 'forward';
      else if (mod && (k === '=' || k === '+')) act = 'zoom-in';
      else if (mod && k === '-') act = 'zoom-out';
      else if (mod && k === '0') act = 'zoom-reset';
      else if (i.key === 'Escape' && wc.isLoading()) act = 'stop';
      if (!act) return;
      e.preventDefault();
      if (act === 'reload') wc.reload();
      else if (act === 'stop') wc.stop();
      else if (act === 'back') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
      else if (act === 'forward') { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
      else if (act === 'zoom-in') wc.setZoomLevel(Math.min(5, wc.getZoomLevel() + 0.5));
      else if (act === 'zoom-out') wc.setZoomLevel(Math.max(-5, wc.getZoomLevel() - 0.5));
      else if (act === 'zoom-reset') wc.setZoomLevel(0);
      else send('mineclaude:web-key', { wcId: wc.id, act });
    });

    wc.on('context-menu', (_e, p) => {
      const TR = tr();
      const items = [];
      if (p.linkURL && /^https?:/i.test(p.linkURL)) {
        items.push(
          { label: TR ? 'Bağlantıyı yeni sekmede aç' : 'Open link in new tab', click: () => send('mineclaude:web-open', { url: p.linkURL }) },
          { label: TR ? 'Bağlantıyı varsayılan tarayıcıda aç' : 'Open link in default browser', click: () => shell.openExternal(p.linkURL) },
          { label: TR ? 'Bağlantı adresini kopyala' : 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
          { type: 'separator' });
      }
      if (p.mediaType === 'image' && p.srcURL) {
        items.push(
          { label: TR ? 'Resmi yeni sekmede aç' : 'Open image in new tab', click: () => send('mineclaude:web-open', { url: p.srcURL }) },
          { label: TR ? 'Resim adresini kopyala' : 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
          { type: 'separator' });
      }
      if (p.isEditable) {
        items.push(
          { label: TR ? 'Kes' : 'Cut', role: 'cut', enabled: p.editFlags.canCut },
          { label: TR ? 'Kopyala' : 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
          { label: TR ? 'Yapıştır' : 'Paste', role: 'paste', enabled: p.editFlags.canPaste },
          { label: TR ? 'Tümünü seç' : 'Select all', role: 'selectAll' },
          { type: 'separator' });
      } else if (p.selectionText) {
        const q = p.selectionText.trim().slice(0, 200);
        items.push(
          { label: TR ? 'Kopyala' : 'Copy', role: 'copy' },
          { label: (TR ? 'Google’da ara: “' : 'Search Google for “') + (q.length > 30 ? q.slice(0, 30) + '…' : q) + '”',
            click: () => send('mineclaude:web-open', { url: 'https://www.google.com/search?q=' + encodeURIComponent(q) }) },
          { type: 'separator' });
      }
      const h = wc.navigationHistory;
      items.push(
        { label: TR ? 'Geri' : 'Back', enabled: h.canGoBack(), click: () => h.goBack() },
        { label: TR ? 'İleri' : 'Forward', enabled: h.canGoForward(), click: () => h.goForward() },
        { label: TR ? 'Yenile' : 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: TR ? 'Sayfayı varsayılan tarayıcıda aç' : 'Open page in default browser', click: () => shell.openExternal(wc.getURL()) },
        { label: TR ? 'Öğeyi incele' : 'Inspect element', click: () => wc.inspectElement(p.x, p.y) });
      Menu.buildFromTemplate(items).popup({ window: win });
    });
  });
}

module.exports = { attach, PARTITION };
