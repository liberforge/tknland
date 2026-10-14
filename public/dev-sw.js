// Replaces the Vite dev service worker. That worker cached a broken page and
// left Safari on a blank screen. Install, drop the caches, and unregister.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        windows.map((client) => ("navigate" in client ? client.navigate(client.url) : undefined)),
      );
    })(),
  );
});
