// Always revalidate the site's own files with the server, so a new deploy
// shows up on the next load instead of after GitHub Pages' 10-minute cache.
// Unchanged files come back as cheap 304s. Nothing is stored for offline use.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }));
});
