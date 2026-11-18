/* Service worker: guarda la app en el iPad para que funcione sin internet.
   Solo guarda los archivos de la app; tus datos nunca pasan por aquí.
   Con internet siempre trae la versión más nueva; sin internet usa la guardada. */
const CACHE = 'panel-v12';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/vault.js',
  'js/combo.js',
  'js/xlsx.js',
  'js/mapa.js',
  'js/app.js',
  'data/secciones-chihuahua.geojson',
  'data/zonas-cp-chihuahua.geojson',
  'data/colonias-chihuahua.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: true }) ||
        (req.mode === 'navigate' ? await cache.match('index.html') : null);
      return cached || new Response('Sin conexión', { status: 503 });
    }
  })());
});
