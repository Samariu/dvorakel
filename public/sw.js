// Dvorakel offline cache.
// Network first: online you always get the latest version; every successful
// response is also stored, so the app still opens when you are offline.
const CACHE = 'dvorakel-v2';

// On install, store the start page and the files it references, so the app
// opens offline even if it was only visited once.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const startUrl = new URL('./', self.registration.scope).href;
      const res = await fetch(startUrl, { cache: 'no-cache' });
      if (!res.ok) return;
      const html = await res.clone().text();
      await cache.put(startUrl, res);
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => new URL(m[1], startUrl))
        .filter((u) => u.origin === self.location.origin)
        .map((u) => u.href);
      await cache.addAll([...new Set(assets)]);
    })().then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dvorakel-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        // ignoreVary: module scripts send an Origin header that the cached copy may not have.
        const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate', ignoreVary: true });
        if (hit) return hit;
        // Any navigation inside the app falls back to the cached start page.
        if (req.mode === 'navigate') {
          const start = await caches.match(new URL('./', self.registration.scope).href, { ignoreVary: true });
          if (start) return start;
        }
        return Response.error();
      }),
  );
});
