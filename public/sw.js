// sw.js — Ottle PWA service worker (offline cache + installable)
const CACHE_NAME = "ottle-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./logo.png",
  "./logo.jpg",
  "./faviconpng.png",
  "./css/styles.css",
  "./js/app.js",
  "./js/api.js",
  "./js/auth.js",
  "./js/firebase.js",
  "./js/store.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  // Only cache same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone)).catch(() => {});
        return resp;
      }).catch(() => cached)
    )
  );
});
