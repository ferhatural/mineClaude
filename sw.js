/* mineClaude service worker — PWA olarak kurulabilmek ve sunucu kapaliyken
   "sunucu calismiyor" sayfasini gosterebilmek icin.

   Strateji bilerek network-first: veri her zaman canli olmali, onbellek yalnizca
   sunucu kapaliyken devreye giriyor. Boylece gelistirirken bayat dosya servis edilmiyor. */

const CACHE = 'mineclaude-v1';
const SHELL = [
  '/', '/office.css', '/office.js', '/office3d.js',
  '/vendor/three.module.min.js', '/vendor/three.core.min.js',
  '/manifest.webmanifest', '/offline.html',
  '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // canli veri kanallarina hic dokunma
  if (url.pathname === '/events' || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => (
        hit || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error())
      ))),
  );
});
