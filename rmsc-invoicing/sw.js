/* Service worker: lets the app open and work with no signal.
   Bump VERSION whenever you change any app file so phones pick up the update. */
const VERSION = 'rmsc-v2.0.0';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/logo.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
const EXTRA = ['https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Nice to have offline (PDF maker) – don't fail the install if it can't be fetched.
    await Promise.all(EXTRA.map(u => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('rmsc-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // App files: use the latest copy when online (so GitHub updates show straight away),
    // fall back to the saved copy when there's no signal or the network is very slow.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const network = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      });
      const timeout = new Promise(resolve => setTimeout(resolve, 4000));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch (e) { /* offline */ }
      const cached = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
      if (cached) return cached;
      try { return await network; } catch (e) { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
    })());
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // Fonts and libraries: cache first.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
  }
});
