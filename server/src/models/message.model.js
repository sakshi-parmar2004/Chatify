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
//
// Superseded by the per-participant cursors on Conversation (DEC-03); kept
// because the pre-PLT-01 receipt paths still read it until the contract step.
export const UNREAD_STATUSES = [MESSAGE_STATUS.SENT, MESSAGE_STATUS.DELIVERED];

/**
 * A copy of the quoted message taken at reply time.
 *
 * Denormalised on purpose: a reply must still render when its parent is
 * tombstoned, and rendering a list of replies should not mean a lookup per row.
 * Edits to the parent update this through the edit path.
 */
const replySnapshotSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, default: "" },
    hasImage: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true, maxlength: 8 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false }
);

/** A file that went straight to Cloudinary from the browser (MED-01). */
const attachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["image", "video", "audio", "file"], required: true },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    name: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
    // audio and video only
    durationSeconds: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

/** An unfurled link (MSG-09). Filled in asynchronously after the message lands. */
const linkPreviewSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    siteName: { type: String, default: "" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Retained through the migrate-reads step so this phase stays revertible.
    // Nothing reads it any more; it is dropped at the contract step (DEC-02),
    // and it is meaningless for groups.
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
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
    attachment: { type: attachmentSchema, default: null },
    linkPreview: { type: linkPreviewSchema, default: null },
    // "delivered" means the message reached a live client, not that a human saw
    // it. Only "read" implies that. Superseded by conversation cursors.
    status: {
      type: String,
      enum: Object.values(MESSAGE_STATUS),
      default: MESSAGE_STATUS.SENT,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    replySnapshot: { type: replySnapshotSchema, default: null },
    reactions: { type: [reactionSchema], default: [] },
    editedAt: { type: Date, default: null },
    // Tombstone rather than removal (DEC-08): a hard delete punches a hole in
    // pagination cursors and orphans every reply that quotes it.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Conversation lookups filter on both participants in either direction, so both
// orderings are indexed. Without these, every chat load is a collection scan.
// Dropped at the contract step along with receiverId.
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, status: 1, senderId: 1 });

// The query shape everything now uses: a conversation's messages, newest first.
// Also serves the unread count, which is "messages in this conversation newer
// than my read cursor".
messageSchema.index({ conversationId: 1, createdAt: -1 });

// MSG-07. Scoped per conversation at query time; Mongo allows only one text
// index per collection, which is part of why DEC-10 accepts its limits.
messageSchema.index({ text: "text" });

const Message = mongoose.model("Message", messageSchema);

export default Message;
