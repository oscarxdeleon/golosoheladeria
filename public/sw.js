// Self-destroying service worker — desregistra cualquier SW previo y limpia
// caches heredados. El modo offline está desactivado en la app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        if (self.caches) {
          const keys = await self.caches.keys();
          await Promise.allSettled(keys.map((k) => self.caches.delete(k)));
        }
        await self.clients.claim();
      } finally {
        await self.registration.unregister();
      }
    })(),
  );
});
