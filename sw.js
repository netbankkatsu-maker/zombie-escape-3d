const CACHE = 'zombie-escape-v2';
const CORE = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(CORE);
      // Three.js CDN はオプション（失敗しても無視）
      try {
        await c.add('https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js');
      } catch (_) {}
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
