import User from "../models/user.model.js";
import { setMute } from "../lib/notifications.js";
import { publicKey, isPushConfigured } from "../lib/push.js";

/** GET /api/notifications/config — what the client needs to subscribe. */
export const getPushConfig = (_req, res) => {
  res.status(200).json({ enabled: isPushConfigured(), publicKey: publicKey() });
};

/**
 * POST /api/notifications/subscribe
 *
 * Idempotent per endpoint: re-subscribing the same browser replaces its keys
 * rather than accumulating duplicates, which is what a page reload does.
 */
export const subscribeToPush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body ?? {};

    if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint)) {
      return res.status(400).json({ message: "Invalid subscription." });
    }
    if (typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
      return res.status(400).json({ message: "Invalid subscription keys." });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );
    await User.updateOne(
      { _id: req.user._id },
      { $push: { pushSubscriptions: { endpoint, keys, failureCount: 0 } } }
    );

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Error in subscribeToPush: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/notifications/subscribe — revoking must actually stop it. */
export const unsubscribeFromPush = async (req, res) => {
  try {
    const { endpoint } = req.body ?? {};
    if (typeof endpoint !== "string") {
      return res.status(400).json({ message: "Invalid subscription." });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error in unsubscribeFromPush: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/notifications/do-not-disturb — NTF-05. */
export const updateDoNotDisturb = async (req, res) => {
  try {
    const { enabled, startMinute, endMinute, timezone } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be true or false." });
    }

    const inRange = (value) => Number.isInteger(value) && value >= 0 && value <= 1439;
    if (enabled && (!inRange(startMinute) || !inRange(endMinute))) {
      return res.status(400).json({ message: "Invalid quiet hours." });
    }
    if (timezone !== undefined && typeof timezone !== "string") {
      return res.status(400).json({ message: "Invalid timezone." });
    }
    if (timezone) {
      try {
        // reject an unknown zone here rather than silently never muting later
        new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
      } catch {
        return res.status(400).json({ message: "Unknown timezone." });
      }
    }

    const doNotDisturb = {
      enabled,
      startMinute: startMinute ?? 22 * 60,
      endMinute: endMinute ?? 7 * 60,
      timezone: timezone ?? "UTC",
    };

    await User.updateOne({ _id: req.user._id }, { $set: { doNotDisturb } });
    res.status(200).json({ doNotDisturb });
  } catch (error) {
    console.error("Error in updateDoNotDisturb: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/notifications/do-not-disturb — so the UI can show why it is quiet. */
export const getDoNotDisturb = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("doNotDisturb").lean();
    res.status(200).json({ doNotDisturb: user?.doNotDisturb ?? { enabled: false } });
  } catch (error) {
    console.error("Error in getDoNotDisturb: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PUT /api/conversations/:id/mute — NTF-04.
 *
 * A duration rather than a boolean, so "mute for 8 hours" does not need a
 * scheduled job to undo it.
 */
export const muteConversation = async (req, res) => {
  try {
    const { minutes } = req.body ?? {};

    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      return res.status(400).json({ message: "Invalid duration." });
    }

    // null clears the mute; a very large value is "indefinitely"
    const mutedUntil =
      minutes === null ? null : new Date(Date.now() + Math.min(minutes, 525_600) * 60_000);

    await setMute(req.conversation._id, req.user._id, mutedUntil);
    res.status(200).json({ mutedUntil });
  } catch (error) {
    console.error("Error in muteConversation: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
