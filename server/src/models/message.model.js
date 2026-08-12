import mongoose from "mongoose";

export const MESSAGE_STATUS = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
};

// Everything not yet read. Queried as an $in rather than { $ne: "read" } for two
// reasons: it gives the index below tight equality bounds, and it excludes
// documents written before this field existed — so old messages do not suddenly
// surface as unread.
export const UNREAD_STATUSES = [MESSAGE_STATUS.SENT, MESSAGE_STATUS.DELIVERED];

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Nullable during the expand phase of PLT-01: writes populate it, reads do
    // not depend on it yet, and the backfill fills it in for existing rows.
    // It becomes required — and receiverId is dropped — at the contract step.
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    image: {
      type: String,
    },
    // "delivered" means the message reached a live client, not that a human saw
    // it. Only "read" implies that. The three states are monotonic and never
    // move backwards.
    status: {
      type: String,
      enum: Object.values(MESSAGE_STATUS),
      default: MESSAGE_STATUS.SENT,
    },
  },
  { timestamps: true }
);

// Conversation lookups filter on both participants in either direction, so both
// orderings are indexed. Without these, every chat load is a collection scan.
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });

// Receipt work always starts from "messages addressed to me in a given state":
// the delivered flush on reconnect ({ receiverId, status: "sent" }) and the
// mark-as-read update ({ receiverId, senderId, status: $in }). senderId comes
// last so the flush, which does not filter on it, still uses the index prefix.
messageSchema.index({ receiverId: 1, status: 1, senderId: 1 });

// The query shape everything moves to at the contract step: a conversation's
// messages, newest first. Also serves the unread count, which becomes
// "messages in this conversation newer than my read cursor".
messageSchema.index({ conversationId: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
