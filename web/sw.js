/**
 * TomiOka · service worker (PWA)
 * ────────────────────────────────────────────────────────────────
 * - Shell de la app precargado: el panel abre instantáneo y sin red.
 * - Estáticos (CSS/JS/fuentes/iconos): stale-while-revalidate.
 * - Navegaciones: red primero, con la shell en caché como respaldo.
 * - /api/ y SSE: siempre red, jamás caché (datos en vivo).
 */
const CACHE = 'tomioka-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];
const STATIC_RE = /\.(?:css|js|woff2?|svg|png|jpe?g|webp|ico|webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // datos en vivo: siempre red

  // Navegaciones SPA: red primero; sin conexión, la shell cacheada.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Estáticos: servir caché al instante y refrescar en segundo plano.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
