import { asyncHandler } from "../lib/asyncHandler.js";
import mongoose from "mongoose";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { emitToConversation } from "../lib/socket.js";

/**
 * How long after sending a message may still be edited or deleted for everyone.
 *
 * DEC-08 left the exact number open; one hour is long enough to cover the
 * "sent to the wrong person" and "spotted a typo" cases that motivate the
 * feature, and short enough that history stays trustworthy. Anything older can
 * still be deleted for yourself, which is a client-side hide.
 */
export const EDIT_WINDOW_MS = 60 * 60 * 1000;

const withinWindow = (message) => Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;

/** Load a message and prove it belongs to the conversation on the route. */
const loadMessage = async (req, res) => {
  const { messageId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    res.status(400).json({ message: "Invalid message id." });
    return null;
  }

  // scoped to the conversation the middleware already authorized, so a valid
  // message id from a conversation the caller is not in resolves to nothing
  const message = await Message.findOne({
    _id: messageId,
    conversationId: req.conversation._id,
  });

  if (!message) {
    res.status(404).json({ message: "Message not found." });
    return null;
  }

  return message;
};

/**
 * PATCH /api/conversations/:id/messages/:messageId
 *
 * Editing only ever changes text. An edit that could add or swap an attachment
 * would let someone rewrite what a reply is quoting after the fact.
 */
export const editMessage = asyncHandler(async (req, res) => {
    const message = await loadMessage(req, res);
    if (!message) return;

    const { text } = req.body;

    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ message: "Text is required." });
    }
    if (text.length > 2000) {
      return res.status(400).json({ message: "Message is too long." });
    }
    if (String(message.senderId) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only edit your own messages." });
    }
    if (message.deletedAt) {
      return res.status(400).json({ message: "That message was deleted." });
    }
    if (!withinWindow(message)) {
      return res.status(400).json({ message: "That message is too old to edit." });
    }

    message.text = text.trim();
    message.editedAt = new Date();
    await message.save();

    // replies quote a snapshot taken at reply time, so they go stale on an edit
    await Message.updateMany(
      { replyTo: message._id },
      { $set: { "replySnapshot.text": message.text } }
    );

    emitToConversation(req.conversation, "messageUpdated", message.toObject());

    res.status(200).json(message);
});

/**
 * DELETE /api/conversations/:id/messages/:messageId
 *
 * A tombstone, not a removal (DEC-08). A hard delete punches a hole in the
 * pagination cursors and orphans every reply that quotes it. The text and any
 * attachment are cleared, so the content really is gone — what remains is the
 * fact that something was here.
 */
export const deleteMessage = asyncHandler(async (req, res) => {
    const message = await loadMessage(req, res);
    if (!message) return;

    const isSender = String(message.senderId) === String(req.user._id);
    const isGroupAdmin =
      req.conversation.type === "group" &&
      (req.conversation.admins ?? []).some((id) => String(id) === String(req.user._id));

    if (!isSender && !isGroupAdmin) {
      return res.status(403).json({ message: "You can only delete your own messages." });
    }
    if (isSender && !isGroupAdmin && !withinWindow(message)) {
      return res.status(400).json({ message: "That message is too old to delete." });
    }
    if (message.deletedAt) return res.status(200).json(message);

    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.text = "";
    message.image = undefined;
    message.attachment = null;
    message.linkPreview = null;
    message.reactions = [];
    await message.save();

    await Message.updateMany(
      { replyTo: message._id },
      { $set: { "replySnapshot.deleted": true, "replySnapshot.text": "" } }
    );

    // a pinned message that no longer exists should not stay pinned
    await Conversation.updateOne(
      { _id: req.conversation._id },
      { $pull: { pinnedMessageIds: message._id } }
    );

    emitToConversation(req.conversation, "messageUpdated", message.toObject());

    res.status(200).json(message);
});

// Anything longer is not a reaction. Kept deliberately permissive about which
// emoji rather than maintaining an allowlist that dates badly.
const MAX_EMOJI_LENGTH = 8;

/**
 * PUT /api/conversations/:id/messages/:messageId/reactions
 *
 * Toggles. Sending the same emoji twice removes it, which makes a double-tap
 * idempotent rather than a double-count.
 */
export const toggleReaction = asyncHandler(async (req, res) => {
    const message = await loadMessage(req, res);
    if (!message) return;

    const { emoji } = req.body;

    if (typeof emoji !== "string" || emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH) {
      return res.status(400).json({ message: "Invalid reaction." });
    }
    if (message.deletedAt) {
      return res.status(400).json({ message: "That message was deleted." });
    }

    const myId = String(req.user._id);
    const existing = message.reactions.findIndex(
      (reaction) => String(reaction.userId) === myId && reaction.emoji === emoji
    );

    if (existing >= 0) message.reactions.splice(existing, 1);
    else message.reactions.push({ emoji, userId: req.user._id });

    await message.save();

    emitToConversation(req.conversation, "messageUpdated", message.toObject());

    res.status(200).json(message);
});

/**
 * GET /api/conversations/search?q=...&conversationId=...
 *
 * MSG-07. Scoped to conversations the caller is in — always, and computed
 * server-side, so a crafted conversationId cannot widen it.
 */
export const searchMessages = asyncHandler(async (req, res) => {
    const myId = req.user._id;
    const q = String(req.query.q ?? "").trim();
    const { conversationId } = req.query;

    if (q.length < 2) {
      return res.status(400).json({ message: "Search for at least two characters." });
    }

    let scope = await Conversation.find({ participants: myId }).select("_id").lean();
    let ids = scope.map((conversation) => conversation._id);

    if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation id." });
      }
      // intersect rather than replace: narrowing is allowed, widening is not
      ids = ids.filter((id) => String(id) === String(conversationId));
      if (ids.length === 0) return res.status(200).json({ results: [] });
    }

    const results = await Message.find({
      conversationId: { $in: ids },
      deletedAt: null,
      $text: { $search: q },
    })
      .select({ score: { $meta: "textScore" }, text: 1, conversationId: 1, senderId: 1, createdAt: 1 })
      .sort({ score: { $meta: "textScore" }, createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ results });
});
