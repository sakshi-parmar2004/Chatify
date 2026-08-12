import { log } from "./logger.js";
import webpush from "web-push";
import User from "../models/user.model.js";
import { env_variable } from "./env.js";

/**
 * NTF-01 — Web Push.
 *
 * VAPID keys are optional configuration on purpose. Without them the app runs
 * exactly as before and every send is a no-op — push is an enhancement, not a
 * dependency, and a missing key must not stop the server booting.
 *
 * Generate a pair with:  npx web-push generate-vapid-keys
 * then set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.
 */
const isConfigured = Boolean(
  env_variable.VAPID_PUBLIC_KEY && env_variable.VAPID_PRIVATE_KEY
);

if (isConfigured) {
  webpush.setVapidDetails(
    env_variable.VAPID_SUBJECT || `mailto:${env_variable.EMAIL_FROM}`,
    env_variable.VAPID_PUBLIC_KEY,
    env_variable.VAPID_PRIVATE_KEY
  );
} else {
  log.warn("web push is not configured; notifications will be skipped");
}

export const isPushConfigured = () => isConfigured;

export const publicKey = () => env_variable.VAPID_PUBLIC_KEY ?? null;

// A subscription that has failed this many times is not coming back.
const MAX_FAILURES = 3;

/**
 * Send to every device a user has registered.
 *
 * Failures are expected and normal — browsers expire subscriptions — so a 404
 * or 410 prunes the subscription immediately rather than being retried. Nothing
 * here throws: a notification that cannot be delivered must not fail the
 * request that triggered it.
 */
export const sendPushToUser = async (userId, payload, { sender = webpush } = {}) => {
  if (!isConfigured) return { sent: 0, pruned: 0 };

  const user = await User.findById(userId).select("pushSubscriptions").lean();
  const subscriptions = user?.pushSubscriptions ?? [];
  if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  const dead = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sender.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload)
        );
        sent += 1;
      } catch (error) {
        // 404/410 mean the browser dropped it — that is a prune, not an error
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          dead.push(subscription.endpoint);
        } else {
          log.warn({ err: error, statusCode: error?.statusCode }, "push delivery failed");
          dead.push(subscription.endpoint); // counted, pruned only past the limit
        }
      }
    })
  );

  if (dead.length > 0) {
    await User.updateOne(
      { _id: userId },
      { $pull: { pushSubscriptions: { endpoint: { $in: dead } } } }
    );
  }

  return { sent, pruned: dead.length };
};

export { MAX_FAILURES };
