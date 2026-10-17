/*
 * Service worker: caches the app shell so the installed app opens offline.
 * Bump CACHE when shipping changes so phones pick up the new files.
 */
const CACHE = 'flexo-todo-v18';
const FILES = [
  './', './index.html', './styles.css', './store.js', './cloud.js', './app.js', './manifest.webmanifest',
  './vendor/supabase-js-2.117.3.min.js',
  './img/icon-192.png', './img/icon-512.png', './img/apple-touch-icon.png', './img/favicon-32.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version never stores stale files.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates show up when online), falling back to the cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    // 'no-cache' revalidates with GitHub Pages (cheap 304 if unchanged) instead of using a stale copy.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
