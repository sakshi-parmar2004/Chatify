import mongoose from "mongoose";
import cloudinary from "../lib/cloudinary.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { emitToConversation, joinConversationRoom, isOnline, emitToUser } from "../lib/socket.js";
import { findOrCreateDirectConversation, stateFor } from "../lib/conversations.js";
import { validateImageDataUri } from "../lib/validateImage.js";
import { firstUrlIn, resolveLinkPreview } from "../lib/linkPreview.js";
import { resolveMentions, recipientsFor } from "../lib/notifications.js";
import { sendPushToUser } from "../lib/push.js";

// A conversation list longer than this is a paging problem, not a page.
const CONVERSATION_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const EPOCH = new Date(0);

/**
 * GET /api/conversations
 *
 * The sidebar in one response: every conversation, newest first, with its last
 * message, its other participants, and how many messages the caller has not
 * read.
 *
 * Three queries rather than one aggregation with nested $lookups — the unread
 * count needs a different cursor per conversation, which is expressible but
 * unreadable. Each of the three is index-covered.
 */
export const listConversations = async (req, res) => {
  try {
    const myId = req.user._id;

    const conversations = await Conversation.find({ participants: myId })
      .sort({ lastMessageAt: -1 })
      .limit(CONVERSATION_LIMIT)
      .lean();

    if (conversations.length === 0) return res.status(200).json([]);

    const ids = conversations.map((conversation) => conversation._id);
    const cursorOf = new Map(
      conversations.map((conversation) => [
        String(conversation._id),
        stateFor(conversation, myId).lastReadAt ?? EPOCH,
      ])
    );

    // Unread is "addressed to me and newer than my read cursor". The cursor
    // differs per conversation, so the match is a union of per-conversation
    // ranges — each of which the { conversationId, createdAt } index serves.
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          senderId: { $ne: myId },
          deletedAt: null,
          // "X added Y" is an event, not something anyone sent you
          type: { $ne: "system" },
          $or: conversations.map((conversation) => ({
            conversationId: conversation._id,
            createdAt: { $gt: cursorOf.get(String(conversation._id)) },
          })),
        },
      },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } },
    ]);

    const lastMessages = await Message.aggregate([
      { $match: { conversationId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$conversationId",
          message: {
            $first: {
              _id: "$_id",
              text: "$text",
              image: "$image",
              attachment: "$attachment",
              createdAt: "$createdAt",
              senderId: "$senderId",
              status: "$status",
              deletedAt: "$deletedAt",
            },
          },
        },
      },
    ]);

    const participantIds = [
      ...new Set(conversations.flatMap((c) => c.participants.map(String))),
    ];
    const users = await User.find({ _id: { $in: participantIds } })
      .select("-password")
      .lean();

    const userById = new Map(users.map((user) => [String(user._id), user]));
    const unreadById = new Map(unreadCounts.map((row) => [String(row._id), row.count]));
    const lastById = new Map(lastMessages.map((row) => [String(row._id), row.message]));

    res.status(200).json(
      conversations.map((conversation) =>
        serializeConversation(conversation, myId, {
          userById,
          unreadCount: unreadById.get(String(conversation._id)) ?? 0,
          lastMessage: lastById.get(String(conversation._id)) ?? null,
        })
      )
    );
  } catch (error) {
    console.error("Error in listConversations: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Shape sent to the client. `partner` is a convenience for direct threads so
 * the UI does not have to filter the participant list on every render; groups
 * get name and avatar instead.
 */
export const serializeConversation = (
  conversation,
  myId,
  { userById, unreadCount = 0, lastMessage = null } = {}
) => {
  const participants = conversation.participants
    .map((participantId) => userById?.get(String(participantId)))
    .filter(Boolean);

  return {
    _id: conversation._id,
    type: conversation.type,
    name: conversation.name ?? null,
    image: conversation.image ?? null,
    participants,
    admins: conversation.admins ?? [],
    partner:
      conversation.type === "direct"
        ? (participants.find((user) => String(user._id) !== String(myId)) ?? null)
        : null,
    lastMessage,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
    mutedUntil: stateFor(conversation, myId).mutedUntil ?? null,
    pinnedMessageIds: conversation.pinnedMessageIds ?? [],
  };
};

/**
 * POST /api/conversations/direct/:userId
 *
 * Opening a chat from the contact list. Idempotent — messaging someone you
 * already have a thread with returns that thread.
 */
export const openDirectConversation = async (req, res) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }
    if (String(myId) === String(userId)) {
      return res.status(400).json({ message: "Cannot open a conversation with yourself." });
    }
    if (!(await User.exists({ _id: userId }))) {
      return res.status(404).json({ message: "User not found." });
    }

    const conversation = await findOrCreateDirectConversation(myId, userId);

    // both sides need to be in the room for the first message to arrive live
    joinConversationRoom(conversation);

    const users = await User.find({ _id: { $in: conversation.participants } })
      .select("-password")
      .lean();

    res.status(200).json(
      serializeConversation(conversation.toObject(), myId, {
        userById: new Map(users.map((user) => [String(user._id), user])),
      })
    );
  } catch (error) {
    console.error("Error in openDirectConversation: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/conversations/:id/messages?before=<ISO>&limit=50
 *
 * Newest page first, older pages by cursor. Closes the half of MSG-08 that
 * BE-I-05 describes: opening a long conversation no longer transfers all of it.
 *
 * Returned in chronological order because that is how the list renders; the
 * cursor for the next page is the oldest createdAt in the response.
 */
export const listMessages = async (req, res) => {
  try {
    const { conversation } = req;
    const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const before = req.query.before ? new Date(req.query.before) : null;

    if (before && Number.isNaN(before.getTime())) {
      return res.status(400).json({ message: "Invalid cursor." });
    }

    const filter = { conversationId: conversation._id };
    if (before) filter.createdAt = { $lt: before };

    // one extra row tells us whether another page exists without a count
    const page = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = page.length > limit;
    const messages = (hasMore ? page.slice(0, limit) : page).reverse();

    res.status(200).json({
      messages,
      hasMore,
      nextCursor: messages.length > 0 ? messages[0].createdAt : null,
    });
  } catch (error) {
    console.error("Error in listMessages: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PATCH /api/conversations/:id/read
 *
 * Advances the caller's read cursor. One write regardless of how many messages
 * or participants are involved — the reason DEC-03 moved off per-message state.
 */
export const markConversationRead = async (req, res) => {
  try {
    const { conversation } = req;
    const myId = req.user._id;

    const current = stateFor(conversation, myId).lastReadAt ?? EPOCH;
    const newest = await Message.findOne({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    // nothing to read, or nothing new since last time
    if (!newest || newest.createdAt <= current) {
      return res.status(200).json({ lastReadAt: current, changed: false });
    }

    const lastReadAt = newest.createdAt;

    await Conversation.updateOne(
      { _id: conversation._id, "participantState.userId": myId },
      { $set: { "participantState.$.lastReadAt": lastReadAt } }
    );

    // the other participants learn their messages were read
    emitToConversation(conversation, "conversationRead", {
      conversationId: String(conversation._id),
      userId: String(myId),
      lastReadAt,
    });

    res.status(200).json({ lastReadAt, changed: true });
  } catch (error) {
    console.error("Error in markConversationRead: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/conversations/:id/messages
 *
 * The conversation-keyed send. Delivery state is now a per-participant cursor
 * rather than a field on the message: a message is "delivered" to whoever has a
 * socket open at the moment it is written.
 */
export const createMessage = async (req, res) => {
  try {
    const { conversation } = req;
    const senderId = req.user._id;
    const { text, image, replyTo, attachment } = req.body;

    if (!text && !image && !attachment) {
      return res.status(400).json({ message: "Text, an image or an attachment is required." });
    }
    if (attachment) {
      const problem = validateAttachment(attachment);
      if (problem) return res.status(400).json({ message: problem });
    }
    if (image) {
      const validation = validateImageDataUri(image);
      if (!validation.ok) return res.status(400).json({ message: validation.message });
    }
    if (replyTo && !mongoose.Types.ObjectId.isValid(replyTo)) {
      return res.status(400).json({ message: "Invalid reply target." });
    }

    let replyToMessage = null;
    if (replyTo) {
      replyToMessage = await Message.findOne({
        _id: replyTo,
        conversationId: conversation._id,
      }).lean();
      // replying across conversations would leak the quoted text
      if (!replyToMessage) {
        return res.status(400).json({ message: "Cannot reply to that message." });
      }
    }

    let imageUrl;
    if (image) {
      const uploaded = await cloudinary.uploader.upload(image, { folder: "messages" });
      imageUrl = uploaded.secure_url;
    }

    // GRP-04 — resolved against the participant list, so an @name that is not
    // in this conversation is just text
    const participantUsers = await User.find({ _id: { $in: conversation.participants } })
      .select("name")
      .lean();
    const mentions = resolveMentions(text, participantUsers);

    const newMessage = await Message.create({
      conversationId: conversation._id,
      mentions,
      senderId,
      // still written for the direct case so a rollback of this phase keeps
      // working; nothing reads it any more
      receiverId:
        conversation.type === "direct"
          ? conversation.participants.find((p) => String(p) !== String(senderId))
          : undefined,
      text,
      image: imageUrl,
      attachment: attachment ?? null,
      replyTo: replyToMessage?._id ?? null,
      replySnapshot: replyToMessage
        ? {
            senderId: replyToMessage.senderId,
            text: replyToMessage.text ?? "",
            hasImage: Boolean(replyToMessage.image),
          }
        : undefined,
    });

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessageAt: newMessage.createdAt } }
    );

    // the sender has by definition read their own message
    await Conversation.updateOne(
      { _id: conversation._id, "participantState.userId": senderId },
      { $set: { "participantState.$.lastReadAt": newMessage.createdAt } }
    );

    await markDeliveredForOnlineParticipants(conversation, newMessage);

    // to the room, which includes the sender's other tabs; the originating tab
    // dedupes on _id against the 201 below
    emitToConversation(conversation, "newMessage", newMessage.toObject());

    res.status(201).json(newMessage);

    // Both run after the response and never block it. A slow host or a dead
    // push endpoint must not hold up someone's message.
    void enrichWithLinkPreview(conversation, newMessage);
    void notifyRecipients(conversation, newMessage, req.user);
  } catch (error) {
    console.error("Error in createMessage: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Advance the delivery cursor for everyone who has a socket open right now, and
 * tell the room. "Delivered" means it reached a live client, not that anyone
 * read it.
 */
export const markDeliveredForOnlineParticipants = async (conversation, message) => {
  const online = conversation.participants.filter(
    (participantId) =>
      String(participantId) !== String(message.senderId) && isOnline(participantId)
  );

  if (online.length === 0) return;

  await Promise.all(
    online.map((participantId) =>
      Conversation.updateOne(
        { _id: conversation._id, "participantState.userId": participantId },
        { $max: { "participantState.$.lastDeliveredAt": message.createdAt } }
      )
    )
  );

  for (const participantId of online) {
    emitToConversation(conversation, "conversationDelivered", {
      conversationId: String(conversation._id),
      userId: String(participantId),
      lastDeliveredAt: message.createdAt,
    });
  }
};

/**
 * MED-01 — the client uploads straight to Cloudinary, so what arrives here is a
 * claim about what it uploaded. Bound the shape and the strings; the signature
 * already bounded the folder and the size.
 */
const ATTACHMENT_KINDS = ["image", "video", "audio", "file"];

export const validateAttachment = (attachment) => {
  if (typeof attachment !== "object" || attachment === null) return "Invalid attachment.";
  if (!ATTACHMENT_KINDS.includes(attachment.kind)) return "Unsupported attachment type.";

  if (typeof attachment.url !== "string" || typeof attachment.publicId !== "string") {
    return "Invalid attachment.";
  }
  // only our own asset host, so an attachment cannot become an arbitrary link
  if (!/^https:\/\/res\.cloudinary\.com\//.test(attachment.url)) {
    return "Attachment must be an uploaded file.";
  }
  if (attachment.name && String(attachment.name).length > 255) {
    return "Attachment name is too long.";
  }
  return null;
};

const enrichWithLinkPreview = async (conversation, message) => {
  try {
    const url = firstUrlIn(message.text);
    if (!url) return;

    const preview = await resolveLinkPreview(url);
    if (!preview) return;

    const updated = await Message.findByIdAndUpdate(
      message._id,
      { $set: { linkPreview: preview } },
      { new: true }
    ).lean();

    // the message may have been deleted while we were fetching
    if (updated && !updated.deletedAt) {
      emitToConversation(conversation, "messageUpdated", updated);
    }
  } catch (error) {
    console.error("Error resolving link preview:", error.message);
  }
};

/**
 * NTF-01 / NTF-02 — tell everyone who should be told.
 *
 * Routing lives in lib/notifications so mute and do-not-disturb cannot be
 * honoured by one surface and forgotten by another.
 */
const notifyRecipients = async (conversation, message, sender) => {
  try {
    const recipients = await recipientsFor(conversation, message);
    if (recipients.length === 0) return;

    const title =
      conversation.type === "group"
        ? `${sender.name} in ${conversation.name ?? "a group"}`
        : sender.name;

    const body =
      message.text?.slice(0, 140) ||
      (message.attachment ? `Sent a ${message.attachment.kind}` : "Sent a message");

    for (const recipient of recipients) {
      // in-app, for a tab that is open but not focused (NTF-02)
      emitToUser(recipient._id, "notify", {
        conversationId: String(conversation._id),
        messageId: String(message._id),
        title,
        body,
      });

      void sendPushToUser(recipient._id, {
        title,
        body,
        conversationId: String(conversation._id),
      });
    }
  } catch (error) {
    console.error("Error notifying recipients:", error.message);
  }
};
