// Minimal service worker — required by iOS/Android for "Add to Home Screen"
// to behave like a standalone app. No offline caching is attempted here
// since the dashboard always needs a live connection to the bot server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass-through: always hit the network.
});
