/* Offline cache for the Darul Uloom Fantasy League.
   Bump VERSION whenever any file below changes so phones pick up the update. */
const VERSION = 'duf-v1.0.1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'config.js', 'firebase-config.js', 'core.js', 'demo.js', 'store.js', 'app.js',
  'players.json', 'manifest.webmanifest',
  'vendor/firebase-app-compat-10.14.1.js', 'vendor/firebase-auth-compat-10.14.1.js', 'vendor/firebase-firestore-compat-10.14.1.js',
  'fonts/BarlowCondensed-Medium.woff2', 'fonts/BarlowCondensed-Bold.woff2', 'fonts/BarlowCondensed-ExtraBold.woff2',
  'fonts/Amiri-Regular.woff2', 'fonts/Amiri-Bold.woff2',
  'icons/logo-256.jpg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'data/league/league.json', 'data/league/data/squads.json', 'data/league/data/matches.json', 'data/league/data/goals.json',
  'data/league/data/appearances.json', 'data/league/fixtures/index.json', 'data/league/fixtures/week-01.json',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('duf-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // live league data: network first, fall back to the last copy
  if (url.hostname === 'raw.githubusercontent.com') {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return res; }).catch(() => caches.match(req)));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(caches.match('index.html').then((r) => r || fetch(req))); return; }
  // players.json may change during the season: network first
  if (url.pathname.endsWith('players.json') || url.pathname.includes('/data/league/')) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return res; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.openWindow('./#pick')); });
