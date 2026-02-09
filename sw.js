/**
 * Ekot PWA Service Worker v2.1.0
 * Caches app shell for offline use, network-first for API data
 */

const CACHE_NAME = 'ekot-pwa-v2.1.0';

const APP_SHELL = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.webmanifest',
    './assets/silence.wav',
    './assets/icon-favicon.ico',
    './assets/icon-16x16.png',
    './assets/icon-32x32.png',
    './assets/icon-48x48.png',
    './assets/icon-72x72.png',
    './assets/icon-96x96.png',
    './assets/icon-128x128.png',
    './assets/icon-144x144.png',
    './assets/icon-152x152.png',
    './assets/icon-167x167.png',
    './assets/icon-180x180.png',
    './assets/icon-192x192.png',
    './assets/icon-384x384.png',
    './assets/icon-512x512.png',
    './assets/icon-apple-touch-icon.png',
    './assets/icon-gray-96x96.png',
    './assets/icon-gray-192x192.png'
];

// Install: cache app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first for API, cache-first for app shell
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // SR API requests: network-first, cache fallback
    if (url.hostname === 'api.sr.se') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache a copy of successful API responses
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put('sr-api-latest', clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Offline: return cached API response
                    return caches.match('sr-api-latest');
                })
        );
        return;
    }

    // SR audio files: network only (too large to cache by default)
    if (url.hostname === 'static-cdn.sr.se') {
        event.respondWith(fetch(event.request));
        return;
    }

    // App shell: cache-first, network fallback
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    // Cache new static assets
                    if (response.ok && event.request.method === 'GET') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                });
            })
    );
});
