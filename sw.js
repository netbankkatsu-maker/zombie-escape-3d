const CACHE = 'zombie-escape-v28';
// index.html と style.css はキャッシュしない → 常にネットワークから最新版を取得
const CORE = [
  './game.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// UI icon SVGs
const UI_ICONS = [
  './icons/ui/heart-plus.svg',
  './icons/ui/heavy-lightning.svg',
  './icons/ui/dread-skull.svg',
  './icons/ui/alarm-clock.svg',
  './icons/ui/crossed-swords.svg',
  './icons/ui/revolver.svg',
  './icons/ui/gears.svg',
  './icons/ui/backpack.svg',
  './icons/ui/baseball-bat.svg',
  './icons/ui/battle-axe.svg',
  './icons/ui/bandage-roll.svg',
  './icons/ui/first-aid-kit.svg',
  './icons/ui/bullets.svg',
  './icons/ui/sawed-off-shotgun.svg',
  './icons/ui/shotgun-rounds.svg',
  './icons/ui/exit-door.svg',
  './icons/ui/run.svg',
  './icons/ui/crowbar.svg',
  './icons/ui/shambling-zombie.svg',
  './icons/ui/house.svg',
  './icons/ui/strongbox.svg',
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
        'https://cdn.socket.io/4.7.2/socket.io.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/MTLLoader.js',
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js',
        ...UI_ICONS,
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
  const url = new URL(e.request.url);
  const path = url.pathname;
  // index.html と style.css は常にネットワーク優先（ボタン等の変更を即反映）
  const networkFirst = path.endsWith('/') || path.endsWith('index.html') || path.endsWith('style.css');
  if (networkFirst) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
