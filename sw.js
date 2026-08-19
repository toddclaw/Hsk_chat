/* Cache the shell and the wordlists so the app opens offline. API calls are
 * never cached -- they are POSTs to OpenRouter and always go to the network. */
const CACHE = "hsk-chat-v3";
/* Install caches only what a first launch needs. The other level files and the
 * reference dictionary total several megabytes, so they are cached on demand by
 * the fetch handler the first time they are actually used. */
const SHELL = [
  "./", "./index.html", "./validator.js", "./manifest.json",
  "./data/hsk1.json", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit))
  );
});
