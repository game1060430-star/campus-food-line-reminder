const CACHE_NAME = "campus-food-local-v20261007-processed1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20261007-processed1",
  "./app.js?v=20261007-processed1",
  "./cloud.js?v=20261007-processed1",
  "./manifest.json",
  "./icon.svg",
  "./vendor/xlsx.full.min.js",
  "./vendor/jszip.min.js",
  "./templates/supplierExcelExample.xlsx",
  "./templates/seasoningstockdataCollegeExcelExample.xlsx",
  "./templates/PrerestaurantingredientExcelExample.xlsx",
  "./templates/PreMenuExcelExample.xlsx"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
