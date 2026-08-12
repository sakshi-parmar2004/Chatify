import { axiosInstance } from "./axios";

/**
 * NTF-01 — Web Push subscription.
 *
 * Permission is requested in context — when the user asks for notifications —
 * never on load. A prompt fired on first paint is the one people deny
 * permanently, and there is no second chance.
 */

const urlBase64ToUint8Array = (base64) => {
  // VAPID keys are URL-safe base64 without padding; the Push API wants bytes
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
};

export const isPushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const pushPermission = () => (isPushSupported() ? Notification.permission : "unsupported");

/** @returns true when a subscription is now registered on the server. */
export const enablePush = async () => {
  if (!isPushSupported()) return false;

  const { data: config } = await axiosInstance.get("/notifications/config");
  if (!config.enabled || !config.publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // reuse an existing subscription rather than stacking a new one per reload
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));

  const { endpoint, keys } = subscription.toJSON();
  await axiosInstance.post("/notifications/subscribe", { endpoint, keys });
  return true;
};

/** Revoking must actually stop delivery, not just hide the toggle. */
export const disablePush = async () => {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await axiosInstance
    .delete("/notifications/subscribe", { data: { endpoint: subscription.endpoint } })
    .catch(() => {});
  await subscription.unsubscribe();
};
