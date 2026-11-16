// Service worker: permite que la app funcione sin conexión.
// IMPORTANTE: cuando cambies cualquier archivo, sube el número de versión
// (v1 -> v2 -> v3...) para que los móviles descarguen la versión nueva.
const CACHE = 'botiquin-v2';
const CACHE_LIBS = 'botiquin-libs-zxing-0.21.3'; // el lector de códigos, guardado aparte
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'
];
const ARCHIVOS = [
  './', './index.html', './manifest.json',
  './css/styles.css', './js/app.js', './js/db.js', './js/scan.js', './js/cima.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Borra cachés de versiones anteriores
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE && k !== CACHE_LIBS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia: responder al instante desde la caché y actualizarla en segundo plano.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Lector de códigos (otro dominio): primero la copia guardada; si no existe, se descarga y se guarda
  if (LIBS.includes(req.url)) {
    e.respondWith(caches.match(req).then((g) => g || fetch(req).then((r) => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE_LIBS).then((ca) => ca.put(req, c)); }
      return r;
    })));
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((guardado) => {
      const red = fetch(req)
        .then((resp) => {
          if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
          return resp;
        })
        .catch(() => guardado);
      return guardado || red;
    })
  );
});
