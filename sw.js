/* Cache strategy is split by what the file is.
 *
 * The shell (page, script, manifest) is network-first: an installed home-screen
 * app must show the deployed version, and cache-first meant a redeploy could
 * never reach it. The wordlists are cache-first -- they are large, they change
 * only when a level file is regenerated, and a stale one is still correct.
 *
 * API calls never touch this: they are cross-origin POSTs to OpenRouter.
 */
const CACHE = "hsk-chat-v56";

// Installed up front: only what a first launch needs. The other level files and
// the reference dictionary total a few megabytes and are cached on first use.
const SHELL = [
  "./", "./index.html", "./validator.js", "./prompt.js", "./md.js", "./time.js", "./pace.js", "./senses.js", "./sync.js",
  "./manifest.json", "./data/hsk1.json", "./icon-192.png", "./icon-512.png"
];

const isShell = path => path.endsWith("/") ||
  /\/(index\.html|validator\.js|prompt\.js|md\.js|time\.js|pace\.js|senses\.js|sync\.js|manifest\.json)$/.test(path);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks for this after a manual update check.
self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
  if (e.data === "VERSION") e.source.postMessage({ type: "VERSION", cache: CACHE });
});

function fill(request, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(request, copy));
  }
  return res;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (isShell(url.pathname)) {
    /* cache: "reload" is the point of this branch. A plain fetch is still served
     * by the browser's own HTTP cache -- GitHub Pages sends max-age=600 -- so
     * network-first without it returns the same stale page it was meant to fix. */
    const fresh = new Request(e.request.url, { cache: "reload", credentials: "same-origin" });
    e.respondWith(
      fetch(fresh)
        .then(res => fill(e.request, res))
        .catch(() => caches.match(e.request).then(hit => hit || Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => fill(e.request, res)).catch(() => Response.error()))
  );
});
