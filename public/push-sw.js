// Show push notifications and open the right screen when one is tapped.
// Loaded into the app's service worker (see vite.config.ts → workbox.importScripts).

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Notification";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: data.tag,
    // The server sends a link relative to the app (e.g. "#/todos?open=…").
    data: { url: new URL(data.url || "", self.registration.scope).href },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      // navigate() only works on tabs this worker controls; otherwise open the item in a new window.
      try { if (await open.navigate(url)) return; } catch { /* not controlled yet */ }
    }
    return self.clients.openWindow(url);
  })());
});
