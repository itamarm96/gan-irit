// Network-first for the app document so a refresh (while online) always shows
// the latest deployed version; falls back to cache when offline. Static assets
// use stale-while-revalidate. Installing to the home screen is one-time —
// content updates never require reinstalling.
const CACHE = 'ganirit-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var isDoc = req.mode === 'navigate' || req.destination === 'document' ||
              req.url.endsWith('/') || req.url.endsWith('index.html');
  if (isDoc) {
    // network-first: freshest app, fall back to cache offline
    e.respondWith(
      fetch(req).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return resp;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
  } else {
    // static assets: serve cache fast, refresh in background
    e.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req).then(function (resp) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return resp;
        }).catch(function () { return cached; });
        return cached || net;
      })
    );
  }
});
