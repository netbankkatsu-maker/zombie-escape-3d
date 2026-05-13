const CACHE = 'zombie-escape-v5';
const CORE = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Model files cached on first fetch (not blocking install)
const MODEL_FILES = [
  './models/zombie/Zombie_Atlas.png',
  './models/zombie/Zombie_Basic.obj',
  './models/zombie/Zombie_Basic.mtl',
  './models/zombie/Characters_Matt.obj',
  './models/zombie/Characters_Matt.mtl',
  './models/zombie/Chest.obj',
  './models/zombie/Chest.mtl',
  './models/zombie/Container_Green.obj',
  './models/zombie/Container_Green.mtl',
  './models/zombie/WoodenBat_Barbed.obj',
  './models/zombie/WoodenBat_Barbed.mtl',
  './models/zombie/WoodenBat_Saw.obj',
  './models/zombie/WoodenBat_Saw.mtl',
  './models/zombie/Axe.obj',
  './models/zombie/Axe.mtl',
  './models/guns/Pistol_1.obj',
  './models/guns/Pistol_1.mtl',
  './models/guns/Shotgun_2.obj',
  './models/guns/Shotgun_2.mtl',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(CORE);
      // CDN and models are optional — failure won't block install
      const optionals = [
        'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/MTLLoader.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js',
        ...MODEL_FILES,
      ];
      await Promise.all(optionals.map(url => c.add(url).catch(() => {})));
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
