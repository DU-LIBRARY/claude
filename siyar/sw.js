/* Offline cache for the Siyar reader.
   Bump VERSION whenever any app-shell file or the fact data changes. Volume text files live in a
   separate cache, served cache-first; on an update the stored volumes are carried over (the Arabic
   text never changes with the app shell). Bump TEXT_REV when the volume files themselves change:
   stored volumes are then carried over only from caches of the same text revision. */
const VERSION = 'v1.0.1';
const TEXT_REV = 't2';
const SHELL = 'siyar-' + VERSION;
const VOLS = 'siyar-vols-' + TEXT_REV + '-' + VERSION;
const ASSETS = [
  './', 'index.html', 'app.js', 'manifest.json',
  'vendor/motion-11.11.17.min.js',
  'data/siyar.json', 'data/full/index.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/amiri-arabic-400-normal.woff2', 'fonts/amiri-arabic-700-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-400-normal.woff2', 'fonts/ibm-plex-sans-latin-ext-500-normal.woff2', 'fonts/ibm-plex-sans-latin-ext-600-normal.woff2',
  'fonts/source-serif-4-latin-ext-opsz-italic.woff2', 'fonts/source-serif-4-latin-ext-opsz-normal.woff2',
  'fonts/source-serif-4-latin-opsz-italic.woff2', 'fonts/source-serif-4-latin-opsz-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const newVols = await caches.open(VOLS);
    for (const k of keys) {
      if (k.startsWith('siyar-vols-' + TEXT_REV + '-') && k !== VOLS) {
        const old = await caches.open(k);
        for (const req of await old.keys()) {
          if (!(await newVols.match(req))) { const r = await old.match(req); if (r) await newVols.put(req, r); }
        }
      }
    }
    await Promise.all(keys.filter((k) => k.startsWith('siyar-') && k !== SHELL && k !== VOLS).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: SHELL }).then((r) => r || fetch(req)));
    return;
  }
  if (/\/data\/full\/vol\d+\.json$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(VOLS);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') e.waitUntil(c.put(req, res.clone()));
      return res;
    })());
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true, cacheName: SHELL }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
