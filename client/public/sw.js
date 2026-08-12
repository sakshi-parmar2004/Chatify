/* Chatify service worker — NTF-01.
 *
 * Deliberately minimal: it exists to receive push events and route a click.
 * It does not cache anything, because a stale cached shell is a worse bug than
 * a slow load, and offline is an explicit non-goal.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Chatify", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Chatify", {
      body: payload.body || "",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      // one notification per conversation, so ten messages are one line
      tag: payload.conversationId || "chatify",
      renotify: true,
      data: { conversationId: payload.conversationId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { conversationId } = event.notification.data ?? {};
  const target = conversationId ? `/?conversation=${conversationId}` : "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // focus an existing tab rather than opening a duplicate
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "open-conversation", conversationId });
          return;
        }
      }

      await self.clients.openWindow(target);
    })()
  );
});
