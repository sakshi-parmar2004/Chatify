import Conversation, { CONVERSATION_TYPE } from "../models/conversation.model.js";

/**
 * Stable identity for a one-to-one thread, independent of who wrote first.
 * Sorting is what makes (a,b) and (b,a) the same conversation.
 */
export const directParticipantKey = (userA, userB) =>
  [String(userA), String(userB)].sort((a, b) => a.localeCompare(b)).join(":");

/**
 * Resolve the direct conversation between two users, creating it if needed.
 *
 * A find-then-insert would be a check-then-act race: two people messaging each
 * other for the first time in the same instant both find nothing and both
 * insert. This is a single atomic upsert against the unique participantKey, so
 * the loser of that race gets the winner's document rather than a duplicate.
 */
export const findOrCreateDirectConversation = async (userA, userB) => {
  const participantKey = directParticipantKey(userA, userB);
  const participants = [userA, userB].sort((a, b) => String(a).localeCompare(String(b)));

  const query = { participantKey, type: CONVERSATION_TYPE.DIRECT };

  try {
    return await Conversation.findOneAndUpdate(
      query,
      {
        $setOnInsert: {
          type: CONVERSATION_TYPE.DIRECT,
          participantKey,
          participants,
          participantState: participants.map((userId) => ({
            userId,
            lastReadAt: null,
            lastDeliveredAt: null,
          })),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // An upsert is not atomic against a unique index when two of them race:
    // both miss the document, both try to insert, and the loser gets a
    // duplicate key error rather than the winner's document. The row is
    // guaranteed to exist by the time we see this, so read it.
    //
    // Without this, two people messaging each other for the first time in the
    // same instant would see one of the sends fail outright.
    if (error.code === 11000) {
      const existing = await Conversation.findOne(query);
      if (existing) return existing;
    }
    throw error;
  }
};

/** The other participant, from one participant's point of view. */
export const partnerOf = (conversation, userId) =>
  conversation.participants.find((participant) => String(participant) !== String(userId));

/** A participant's read cursors, or nulls when they have never read anything. */
export const stateFor = (conversation, userId) =>
  conversation.participantState?.find((state) => String(state.userId) === String(userId)) ?? {
    lastReadAt: null,
    lastDeliveredAt: null,
  };
