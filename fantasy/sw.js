/* The fantasy app moved to https://du-library.github.io/fantasy-/.
   This replaces the old service worker: it clears the old cache, unregisters itself
   and sends any open copy of the app to the new address. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('duf-')) await caches.delete(k);
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: 'window' });
    for (const c of cs) c.navigate('https://du-library.github.io/fantasy-/').catch(() => {});
  })());
});
