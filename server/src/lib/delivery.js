import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import { stateFor } from "./conversations.js";

const EPOCH = new Date(0);

/**
 * Lives here rather than in a controller so socket.js can call it without an
 * import cycle — the controllers import socket.js, not the other way round.
 */
export const conversationIdsFor = async (userId) => {
  const conversations = await Conversation.find({ participants: userId })
    .select("_id")
    .lean();
  return conversations.map((conversation) => conversation._id);
};

/**
 * Advance the delivery cursor for a user who has just come online, for every
 * conversation with something newer than it.
 *
 * The PLT-01 replacement for the per-message flush: one cursor write per
 * conversation instead of one status write per message. Advancing with $max
 * makes it idempotent, so a second tab connecting cannot move anything
 * backwards.
 *
 * @returns the conversations that actually moved, so the caller can notify them
 */
export const flushDeliveredForUser = async (userId) => {
  const conversations = await Conversation.find({ participants: userId }).lean();
  const updated = [];

  for (const conversation of conversations) {
    const cursor = stateFor(conversation, userId).lastDeliveredAt ?? EPOCH;

    const newest = await Message.findOne({
      conversationId: conversation._id,
      senderId: { $ne: userId },
      createdAt: { $gt: cursor },
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    if (!newest) continue;

    await Conversation.updateOne(
      { _id: conversation._id, "participantState.userId": userId },
      { $max: { "participantState.$.lastDeliveredAt": newest.createdAt } }
    );

    updated.push({ conversation, lastDeliveredAt: newest.createdAt });
  }

  return updated;
};

/**
 * PLT-05 — everyone who shares a conversation with this user.
 *
 * The presence audience. The old design broadcast the complete online roster to
 * every client on every connect and disconnect: O(users^2) in messages, and it
 * told everybody who else was online whether or not they had any relationship.
 */
export const contactIdsFor = async (userId) => {
  const conversations = await Conversation.find({ participants: userId })
    .select("participants")
    .lean();

  const contacts = new Set();
  for (const conversation of conversations) {
    for (const participantId of conversation.participants) {
      if (String(participantId) !== String(userId)) contacts.add(String(participantId));
    }
  }

  return [...contacts];
};
