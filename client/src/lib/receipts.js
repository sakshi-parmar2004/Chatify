/**
 * Derive a message's receipt state from the conversation's per-participant
 * cursors (DEC-03).
 *
 * There is no status stored on the message any more. A message is delivered
 * once every other participant's delivery cursor has reached it, and read once
 * every other participant's read cursor has. "Every" rather than "any" is what
 * makes this honest in a group: one person reading is not the group reading.
 */
export const RECEIPT = {
  SENDING: "sending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
};

export const receiptFor = (message, conversation, cursorsForConversation, authUserId) => {
  if (message.senderId !== authUserId) return null;
  if (message.isOptimistic) return RECEIPT.SENDING;

  const others = (conversation?.participants ?? [])
    .map((participant) => participant._id ?? participant)
    .filter((id) => String(id) !== String(authUserId));

  if (others.length === 0) return RECEIPT.SENT;

  const sentAt = new Date(message.createdAt).getTime();
  const reached = (id, field) => {
    const value = cursorsForConversation?.[String(id)]?.[field];
    return value ? new Date(value).getTime() >= sentAt : false;
  };

  if (others.every((id) => reached(id, "lastReadAt"))) return RECEIPT.READ;
  if (others.every((id) => reached(id, "lastDeliveredAt"))) return RECEIPT.DELIVERED;
  return RECEIPT.SENT;
};

/** How many participants have read it — for the group "seen by" affordance. */
export const readCountFor = (message, conversation, cursorsForConversation, authUserId) => {
  const sentAt = new Date(message.createdAt).getTime();

  return (conversation?.participants ?? [])
    .map((participant) => participant._id ?? participant)
    .filter((id) => String(id) !== String(authUserId))
    .filter((id) => {
      const value = cursorsForConversation?.[String(id)]?.lastReadAt;
      return value ? new Date(value).getTime() >= sentAt : false;
    }).length;
};
