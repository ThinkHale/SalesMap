// sw.js — Service Worker for offline-first caching

const CACHE_NAME = 'salesmap-v10';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/utils.js',
  './js/error-handler.js',
  './js/app-registry.js',
  './js/state-manager.js',
  './js/ui-components.js',
  './js/validation-service.js',
  './js/data-services.js',
  './js/plugin-api.js',
  './plugins/heatmap-overlay.js',
  './plugins/layer-styler.js',
  './js/firebase-config.js',
  './js/geocoding-service.js',
  './js/csv-parser.js',
  './js/map-manager.js',
  './js/layer-manager.js',
  './js/command-history.js',
  './js/analytics-panel.js',
  './js/cluster-manager.js',
  './js/distance-tool.js',
  './js/activity-log.js',
  './js/notification-center.js',
  './js/map-export.js',
  './js/controllers/sync-controller.js',
  './js/controllers/import-controller.js',
  './js/controllers/drawing-controller.js',
  './js/controllers/profile-controller.js',
  './js/controllers/ui-renderer.js',
  './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => {
        // Tell every open tab to reload so it gets the fresh code immediately.
        clients.forEach(client => {
          try { client.navigate(client.url); } catch (e) {}
        });
      })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip Firebase, Google Maps, and CDN requests (always network)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('cdnjs') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('maps.google')
  ) {
    return;
  }

  // Network-first for JS and CSS so code changes are always picked up immediately.
  // Cache is used only as offline fallback.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for HTML and other static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
