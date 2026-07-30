self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data?.type !== "TEST_NOTIFICATION") return;
  event.waitUntil(self.registration.showNotification("NASDAQ Watchlist", {
    body: "알림 테스트가 정상적으로 도착했습니다.",
    tag: "nasdaq-watchlist-test",
    renotify: true,
    data: { url: "./" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "./"));
});
