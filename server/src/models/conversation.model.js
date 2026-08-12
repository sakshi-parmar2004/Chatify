import mongoose from "mongoose";

export const CONVERSATION_TYPE = { DIRECT: "direct", GROUP: "group" };

/**
 * Per-participant read state.
 *
 * Two monotonic watermarks rather than a status on every message: one write per
 * read event regardless of how many people are in the conversation, and unread
 * count becomes a single counted range query. The per-message `Message.status`
 * shipped for one-to-one is O(N) writes per message once N people are involved,
 * which is why it is being replaced here rather than extended.
 */
const participantStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // newest createdAt this participant has read / had delivered to a live client
    lastReadAt: { type: Date, default: null },
    lastDeliveredAt: { type: Date, default: null },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(CONVERSATION_TYPE),
      default: CONVERSATION_TYPE.DIRECT,
    },
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    /**
     * Sorted participant ids joined with a colon. Only set for direct
     * conversations — two groups may legitimately have identical membership,
     * but two people can only have one one-to-one thread.
     *
     * The partial unique index below is what actually enforces that. Without
     * it, two users messaging each other for the first time in the same instant
     * both find nothing and both insert, leaving a split conversation that is
     * very hard to untangle afterwards.
     */
    participantKey: { type: String, default: null },
    // denormalised so the conversation list can sort without touching messages
    lastMessageAt: { type: Date, default: null },
    participantState: { type: [participantStateSchema], default: [] },
  },
  { timestamps: true }
);

conversationSchema.index(
  { participantKey: 1 },
  { unique: true, partialFilterExpression: { type: CONVERSATION_TYPE.DIRECT } }
);

// "my conversations, most recent first" — the sidebar's only query
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
