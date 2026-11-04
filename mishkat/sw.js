const VERSION = 'mishkat-v1.1.0';
/* Offline cache for the Mishkāt Commentary Reader.
   Bump VERSION whenever any file below changes so visitors receive the update. */
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'sync.js',
  'firebase-config.js',
  'manifest.webmanifest',
  'data/meta.json',
  'data/nikah.json',
  'vendor/motion-11.11.17.min.js',
  'vendor/firebase-app-compat-10.14.1.js',
  'vendor/firebase-auth-compat-10.14.1.js',
  'vendor/firebase-firestore-compat-10.14.1.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/amiri-arabic-400-normal.woff2',
  'fonts/amiri-arabic-700-normal.woff2',
  'fonts/noto-naskh-arabic-arabic-400-normal.woff2',
  'fonts/noto-naskh-arabic-arabic-700-normal.woff2',
  'fonts/amiri-latin-400-normal.woff2',
  'fonts/amiri-latin-700-normal.woff2',
  'fonts/noto-naskh-arabic-latin-400-normal.woff2',
  'fonts/noto-naskh-arabic-latin-700-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-600-normal.woff2'
];

async function tell(msg) {
  const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  all.forEach((c) => c.postMessage(msg));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const total = ASSETS.length;
    let done = 0, next = 0, failed = null;
    await tell({ type: 'progress', done, total, version: VERSION });
    // fetch with a small pool so a slow connection is not serialised, and report each completed file
    async function worker() {
      while (!failed && next < total) {
        const url = ASSETS[next++];
        try { await cache.add(new Request(url, { cache: 'reload' })); }
        catch (err) { failed = failed || err; return; }
        done++;
        await tell({ type: 'progress', done, total, version: VERSION });
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
    if (failed) { await tell({ type: 'error', version: VERSION }); throw failed; }
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('mishkat-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d === 'skip-waiting' || (d && d.type === 'skip-waiting')) { self.skipWaiting(); return; }
  if (d === 'status' || (d && d.type === 'status')) {
    e.waitUntil((async () => {
      const cache = await caches.open(VERSION);
      const done = (await cache.keys()).length;
      const reply = { type: 'status', version: VERSION, done: Math.min(done, ASSETS.length), total: ASSETS.length };
      if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
      else if (e.source) e.source.postMessage(reply);
    })());
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: VERSION }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { cacheName: VERSION, ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
