import Message, { MESSAGE_STATUS } from "../models/message.model.js";

/**
 * Flush the messages that were written while this user had no socket open.
 *
 * Lives here rather than in the message controller because socket.js would
 * otherwise have to import that controller, which already imports socket.js.
 *
 * Filtering on "sent" is what makes this idempotent: a second tab connecting
 * matches nothing, and a message that is already "read" can never be pulled
 * back down to "delivered".
 *
 * @returns the distinct sender ids whose messages just became delivered, so the
 * caller can notify them. Empty when there was nothing to do — the normal case.
 */
export const markPendingAsDelivered = async (userId) => {
  const pending = await Message.find(
    { receiverId: userId, status: MESSAGE_STATUS.SENT },
    { senderId: 1 }
  ).lean();

  if (pending.length === 0) return [];

  await Message.updateMany(
    { _id: { $in: pending.map((message) => message._id) } },
    { $set: { status: MESSAGE_STATUS.DELIVERED } }
  );

  return [...new Set(pending.map((message) => String(message.senderId)))];
};
