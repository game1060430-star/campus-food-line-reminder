const CACHE = "campus-food-local-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./templates/PreMenuExcelExample.xlsx",
  "./templates/PrerestaurantingredientExcelExample.xlsx",
  "./templates/seasoningstockdataCollegeExcelExample.xlsx",
  "./templates/supplierExcelExample.xlsx"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(caches.match(event.request).then(match => match || fetch(event.request)));
});
