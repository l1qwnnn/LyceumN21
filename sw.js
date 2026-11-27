'use strict';

var CACHE = 'lyceum21-v12';
var ASSETS = [
  './', './index.html', './style.css', './data.js', './app.js', './manifest.webmanifest',
  './assets/icon.svg', './assets/logo.jpg', './assets/photos/liceum-facade.jpg', './assets/photos/liceum-entrance.jpg'
];
var cachedUrls = new Set(ASSETS.map(function (item) { return new URL(item, self.registration.scope).href; }));

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.startsWith('lyceum21-') && key !== CACHE; }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || !cachedUrls.has(request.url)) return;
  event.respondWith(fetch(request).then(function (response) {
    if (response.ok) {
      var copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(request, copy); }));
    }
    return response;
  }).catch(function () { return caches.open(CACHE).then(function (cache) { return cache.match(request); }); }));
});

