/**
 * Ekot PWA Service Worker
 * Caches app shell for offline use, network-first for API data
 */

importScripts('./version.js');

const CACHE_NAME = 'ekot-pwa-v' + APP_VERSION;

const APP_SHELL = [
    './',
    './index.html',
    './version.js',
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
    './assets/icon-tile-384x384.png'
];

// Install: cache app shell (bypass HTTP cache to guarantee fresh files)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache =>
                Promise.all(
                    APP_SHELL.map(url =>
                        fetch(url, { cache: 'reload' })
                            .then(res => cache.put(url, res))
                    )
                )
            )
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches, reload clients running old versions
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
         .then(() => {
            // Notify all open clients to reload (catches pre-2.1.3 clients
            // that lack the controllerchange listener)
            self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => client.navigate(client.url));
            });
        })
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

    // SR live streams: network only (continuous byte stream)
    if (url.hostname === 'live1.sr.se' || url.hostname === 'ljud1-cdn.sr.se') {
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
