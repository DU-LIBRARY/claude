/* Offline cache for the Al-Ikmāl Narrator Index.
   Bump VERSION whenever any file below changes so visitors receive the update. */
const VERSION = 'ikmal-v1.3.0';
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'sync.js',
  'firebase-config.js',
  'vendor/firebase-app-compat-10.14.1.js',
  'vendor/firebase-auth-compat-10.14.1.js',
  'vendor/firebase-firestore-compat-10.14.1.js',
  'manifest.webmanifest',
  'data/ikmal.json',
  'vendor/motion-11.11.17.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/amiri-arabic-400-normal.woff2',
  'fonts/amiri-arabic-700-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-600-normal.woff2',
  'fonts/source-serif-4-latin-ext-opsz-italic.woff2',
  'fonts/source-serif-4-latin-ext-opsz-normal.woff2',
  'fonts/source-serif-4-latin-opsz-italic.woff2',
  'fonts/source-serif-4-latin-opsz-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ikmal-') && k !== VERSION).map((k) => caches.delete(k)));
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
    e.respondWith(caches.match('index.html', { cacheName: VERSION }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
