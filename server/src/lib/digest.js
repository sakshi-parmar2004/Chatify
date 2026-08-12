import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { stateFor } from "./conversations.js";
import { shouldNotify } from "./notifications.js";

const EPOCH = new Date(0);

/**
 * NTF-03 — the unread digest.
 *
 * Built as a pure function over the database so it can be tested without
 * sending anything, and so the scheduler is a thin wrapper rather than the
 * feature.
 *
 * Two rules keep it from becoming spam:
 *
 *   - it only counts messages newer than both the read cursor and the last
 *     digest, so the same message is never reported twice
 *   - it returns nothing at all when there is nothing to report, and the caller
 *     sends nothing rather than an empty "you have 0 messages" email
 */
export const buildDigestFor = async (userId, { now = new Date() } = {}) => {
  const user = await User.findById(userId)
    .select("name email doNotDisturb lastDigestAt")
    .lean();
  if (!user) return null;

  const since = user.lastDigestAt ?? EPOCH;
  const conversations = await Conversation.find({ participants: userId }).lean();

  const sections = [];

  for (const conversation of conversations) {
    // muted conversations stay out of the digest as well as out of push —
    // one routing decision, honoured by every surface
    const { notify } = shouldNotify({ user, conversation, now });
    if (!notify) continue;

    const cursor = stateFor(conversation, userId).lastReadAt ?? EPOCH;
    const after = cursor > since ? cursor : since;

    const messages = await Message.find({
      conversationId: conversation._id,
      senderId: { $ne: userId },
      deletedAt: null,
      type: { $ne: "system" },
      createdAt: { $gt: after },
    })
      .sort({ createdAt: 1 })
      .limit(5)
      .select("text senderId createdAt attachment")
      .lean();

    if (messages.length === 0) continue;

    const total = await Message.countDocuments({
      conversationId: conversation._id,
      senderId: { $ne: userId },
      deletedAt: null,
      type: { $ne: "system" },
      createdAt: { $gt: after },
    });

    sections.push({
      conversationId: conversation._id,
      title: conversation.type === "group" ? (conversation.name ?? "Group") : null,
      total,
      preview: messages.map((message) => ({
        text: message.text || (message.attachment ? `[${message.attachment.kind}]` : ""),
        createdAt: message.createdAt,
      })),
    });
  }

  if (sections.length === 0) return null;

  return {
    user: { _id: user._id, name: user.name, email: user.email },
    sections,
    totalUnread: sections.reduce((sum, section) => sum + section.total, 0),
  };
};

/**
 * Mark the digest as sent. Separate from building it so a send failure does not
 * advance the watermark and silently swallow that batch.
 */
export const markDigestSent = (userId, now = new Date()) =>
  User.updateOne({ _id: userId }, { $set: { lastDigestAt: now } });
