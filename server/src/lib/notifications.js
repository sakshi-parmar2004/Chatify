import Conversation from "../models/conversation.model.js";
import User from "../models/user.model.js";
import { stateFor } from "./conversations.js";

/**
 * One place that decides whether a person should be disturbed.
 *
 * Every notification surface — push, desktop, sound, digest — asks this, so
 * mute and do-not-disturb cannot be respected by one and forgotten by another.
 * Principle 4: quiet by default.
 *
 * The order matters. A direct mention overrides a muted conversation, because
 * muting a busy group is how people cope with it and being unreachable is not
 * what they asked for. Do-not-disturb overrides even a mention: that is an
 * account-level "I am asleep", not a per-conversation preference.
 */

/**
 * Resolve @name mentions against a participant list. Never widens past it.
 *
 * Matched against the actual participant names rather than by tokenising on
 * whitespace, because display names contain spaces — "@Ada Lovelace" has to
 * work, and a token-based regex would silently resolve it to nobody. Longest
 * name first, so "@Ana Maria" is not swallowed by a participant called "Ana".
 */
export const resolveMentions = (text, participants) => {
  if (!text) return [];

  const candidates = participants
    .filter((participant) => participant.name)
    .map((participant) => ({
      id: String(participant._id),
      name: participant.name.toLowerCase(),
    }))
    .sort((a, b) => b.name.length - a.name.length);

  const haystack = text.toLowerCase();
  const mentioned = new Set();

  for (let index = haystack.indexOf("@"); index !== -1; index = haystack.indexOf("@", index + 1)) {
    const rest = haystack.slice(index + 1);
    const match = candidates.find((candidate) => rest.startsWith(candidate.name));
    if (match) mentioned.add(match.id);
  }

  return [...mentioned];
};

const isMuted = (conversation, userId) => {
  const { mutedUntil } = stateFor(conversation, userId);
  return Boolean(mutedUntil) && new Date(mutedUntil) > new Date();
};

/**
 * NTF-05 — is it currently a quiet period for this user?
 *
 * Evaluated in the user's own timezone, which they carry with them; a window
 * stored as UTC would drift every time they travelled. A window that wraps
 * midnight (22:00–07:00) is the normal case, not the edge case.
 */
export const inQuietHours = (user, now = new Date()) => {
  const dnd = user?.doNotDisturb;
  if (!dnd?.enabled) return false;

  let minutes;
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: dnd.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    const [hour, minute] = formatted.split(":").map(Number);
    minutes = hour * 60 + minute;
  } catch {
    // an invalid stored timezone must not make the app unreachable
    return false;
  }

  const start = dnd.startMinute ?? 0;
  const end = dnd.endMinute ?? 0;
  if (start === end) return false;

  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end; // wraps midnight
};

/**
 * @returns { notify, reason } — reason is for logging and tests, never shown.
 */
export const shouldNotify = ({ user, conversation, isMentioned = false, now = new Date() }) => {
  if (inQuietHours(user, now)) return { notify: false, reason: "quiet-hours" };
  if (isMentioned) return { notify: true, reason: "mention" };
  if (isMuted(conversation, user._id)) return { notify: false, reason: "muted" };
  return { notify: true, reason: "default" };
};

/** Everyone in a conversation who should be told about this message. */
export const recipientsFor = async (conversation, message) => {
  const others = conversation.participants.filter(
    (id) => String(id) !== String(message.senderId)
  );
  if (others.length === 0) return [];

  const users = await User.find({ _id: { $in: others } })
    .select("name doNotDisturb pushSubscriptions")
    .lean();

  const mentioned = new Set((message.mentions ?? []).map(String));

  return users
    .map((user) => ({
      user,
      ...shouldNotify({ user, conversation, isMentioned: mentioned.has(String(user._id)) }),
    }))
    .filter((entry) => entry.notify)
    .map((entry) => entry.user);
};

/** NTF-04 — mute for a duration, or clear it. */
export const setMute = async (conversationId, userId, mutedUntil) =>
  Conversation.updateOne(
    { _id: conversationId, "participantState.userId": userId },
    { $set: { "participantState.$.mutedUntil": mutedUntil } }
  );
