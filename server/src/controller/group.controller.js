import { asyncHandler } from "../lib/asyncHandler.js";
import mongoose from "mongoose";
import Conversation, { CONVERSATION_TYPE } from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import {
  emitToConversation,
  joinConversationRoom,
  removeFromConversationRoom,
  emitToUser,
} from "../lib/socket.js";
import { serializeConversation } from "./conversation.controller.js";

const MAX_PARTICIPANTS = 100;

const isAdmin = (conversation, userId) =>
  (conversation.admins ?? []).some((id) => String(id) === String(userId));

const isParticipant = (conversation, userId) =>
  conversation.participants.some((id) => String(id) === String(userId));

/** Re-read, re-serialize and push to everyone in the room. */
const broadcastConversation = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) return null;

  const users = await User.find({ _id: { $in: conversation.participants } })
    .select("-password")
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  // serialized per recipient because `partner` and the mute state are relative
  // to whoever is reading
  for (const participantId of conversation.participants) {
    emitToUser(
      participantId,
      "conversationUpdated",
      serializeConversation(conversation, participantId, { userById })
    );
  }

  return { conversation, userById };
};

/**
 * A system line in the conversation, so joins, leaves and renames are visible
 * in context rather than only in a settings screen.
 */
const postSystemMessage = async (conversation, text) => {
  const message = await Message.create({
    conversationId: conversation._id,
    senderId: null,
    type: "system",
    text,
  });

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessageAt: message.createdAt } }
  );
  emitToConversation(conversation, "newMessage", message.toObject());
  return message;
};

/**
 * POST /api/conversations/groups
 *
 * The creator is the first admin. A group with no admin cannot be administered,
 * and there is no way back from that state.
 */
export const createGroup = asyncHandler(async (req, res) => {
    const myId = req.user._id;
    const { name, participantIds } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "A group name is required." });
    }
    if (name.trim().length > 80) {
      return res.status(400).json({ message: "That group name is too long." });
    }
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ message: "Add at least one other person." });
    }
    if (participantIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: "Invalid participant id." });
    }

    // dedupe and always include the creator, whether or not they listed
    // themselves
    const unique = [...new Set([...participantIds.map(String), String(myId)])];

    if (unique.length > MAX_PARTICIPANTS) {
      return res.status(400).json({ message: `A group can hold ${MAX_PARTICIPANTS} people.` });
    }

    const found = await User.countDocuments({ _id: { $in: unique } });
    if (found !== unique.length) {
      return res.status(400).json({ message: "One of those people does not exist." });
    }

    const conversation = await Conversation.create({
      type: CONVERSATION_TYPE.GROUP,
      name: name.trim(),
      participants: unique,
      // groups have no participantKey: two groups may legitimately share
      // membership, which is why the unique index is partial on type
      participantKey: null,
      admins: [myId],
      createdBy: myId,
      participantState: unique.map((userId) => ({
        userId,
        lastReadAt: null,
        lastDeliveredAt: null,
      })),
      lastMessageAt: new Date(),
    });

    joinConversationRoom(conversation);
    await postSystemMessage(conversation, `${req.user.name} created the group`);

    const users = await User.find({ _id: { $in: unique } }).select("-password").lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    for (const participantId of unique) {
      if (String(participantId) === String(myId)) continue;
      emitToUser(
        participantId,
        "conversationUpdated",
        serializeConversation(conversation.toObject(), participantId, { userById })
      );
    }

    res.status(201).json(serializeConversation(conversation.toObject(), myId, { userById }));
});

/** PATCH /api/conversations/:id/group — rename or re-image. Admin only. */
export const updateGroup = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { name, image } = req.body;
    const update = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 80) {
        return res.status(400).json({ message: "Invalid group name." });
      }
      update.name = name.trim();
    }
    if (image !== undefined) {
      if (image !== null && typeof image !== "string") {
        return res.status(400).json({ message: "Invalid image." });
      }
      update.image = image;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    await Conversation.updateOne({ _id: conversation._id }, { $set: update });

    if (update.name && update.name !== conversation.name) {
      await postSystemMessage(
        conversation,
        `${req.user.name} renamed the group to "${update.name}"`
      );
    }

    const result = await broadcastConversation(conversation._id);
    res.status(200).json(
      serializeConversation(result.conversation, req.user._id, { userById: result.userById })
    );
});

/** POST /api/conversations/:id/participants — admin only. */
export const addParticipants = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "No one to add." });
    }
    if (userIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const toAdd = [...new Set(userIds.map(String))].filter(
      (id) => !isParticipant(conversation, id)
    );
    if (toAdd.length === 0) {
      return res.status(400).json({ message: "They are already in this group." });
    }
    if (conversation.participants.length + toAdd.length > MAX_PARTICIPANTS) {
      return res.status(400).json({ message: `A group can hold ${MAX_PARTICIPANTS} people.` });
    }

    const found = await User.countDocuments({ _id: { $in: toAdd } });
    if (found !== toAdd.length) {
      return res.status(400).json({ message: "One of those people does not exist." });
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $push: {
          participants: { $each: toAdd },
          // A new member's read cursor starts at null, so history before they
          // joined does not land as unread. It is still readable — open
          // question 1 in the PRD, answered as "yes, full history", because a
          // group where half the members see a different thread is confusing
          // and hiding it properly needs a per-participant joinedAt filter on
          // every read.
          participantState: {
            $each: toAdd.map((userId) => ({
              userId,
              lastReadAt: null,
              lastDeliveredAt: null,
            })),
          },
        },
      }
    );

    const names = await User.find({ _id: { $in: toAdd } }).select("name").lean();
    const updated = await Conversation.findById(conversation._id).lean();

    joinConversationRoom(updated);
    await postSystemMessage(
      updated,
      `${req.user.name} added ${names.map((user) => user.name).join(", ")}`
    );

    const result = await broadcastConversation(conversation._id);
    res.status(200).json(
      serializeConversation(result.conversation, req.user._id, { userById: result.userById })
    );
});

/**
 * DELETE /api/conversations/:id/participants/:userId
 *
 * Removing yourself is leaving, and needs no admin rights. Removing anyone else
 * does.
 */
export const removeParticipant = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { userId } = req.params;
    const myId = req.user._id;
    const isSelf = String(userId) === String(myId);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }
    if (conversation.type !== CONVERSATION_TYPE.GROUP) {
      return res.status(400).json({ message: "Not a group conversation." });
    }
    if (!isSelf && !isAdmin(conversation, myId)) {
      return res.status(403).json({ message: "Only an admin can remove someone." });
    }
    if (!isParticipant(conversation, userId)) {
      return res.status(404).json({ message: "They are not in this group." });
    }

    // A group whose last admin walks out cannot be administered again, and
    // there is no path back from that.
    const remainingAdmins = (conversation.admins ?? []).filter(
      (id) => String(id) !== String(userId)
    );
    const remainingParticipants = conversation.participants.filter(
      (id) => String(id) !== String(userId)
    );
    if (
      isAdmin(conversation, userId) &&
      remainingAdmins.length === 0 &&
      remainingParticipants.length > 0
    ) {
      return res.status(400).json({
        message: "Promote another admin before leaving.",
      });
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $pull: {
          participants: new mongoose.Types.ObjectId(userId),
          admins: new mongoose.Types.ObjectId(userId),
          participantState: { userId: new mongoose.Types.ObjectId(userId) },
        },
      }
    );

    const removedUser = await User.findById(userId).select("name").lean();
    const updated = await Conversation.findById(conversation._id).lean();

    // Room membership is the delivery boundary, so this is a security step, not
    // a tidy-up: a removed member still in the room keeps receiving messages.
    removeFromConversationRoom(conversation._id, userId);
    emitToUser(userId, "removedFromConversation", {
      conversationId: String(conversation._id),
    });

    if (updated.participants.length > 0) {
      await postSystemMessage(
        updated,
        isSelf ? `${removedUser.name} left` : `${req.user.name} removed ${removedUser.name}`
      );
      await broadcastConversation(conversation._id);
    }

    res.status(200).json({ removed: userId });
});

/** PUT /api/conversations/:id/admins/:userId — promote. Admin only. */
export const promoteToAdmin = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }
    if (!isParticipant(conversation, userId)) {
      return res.status(400).json({ message: "They are not in this group." });
    }
    if (isAdmin(conversation, userId)) {
      return res.status(200).json({ ok: true });
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      { $addToSet: { admins: new mongoose.Types.ObjectId(userId) } }
    );

    const promoted = await User.findById(userId).select("name").lean();
    await postSystemMessage(conversation, `${promoted.name} is now an admin`);
    await broadcastConversation(conversation._id);

    res.status(200).json({ ok: true });
});

/** DELETE /api/conversations/:id/admins/:userId — demote. Admin only. */
export const demoteAdmin = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user id." });
    }
    if (!isAdmin(conversation, userId)) {
      return res.status(400).json({ message: "They are not an admin." });
    }
    if ((conversation.admins ?? []).length <= 1) {
      return res.status(400).json({ message: "A group needs at least one admin." });
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      { $pull: { admins: new mongoose.Types.ObjectId(userId) } }
    );
    await broadcastConversation(conversation._id);

    res.status(200).json({ ok: true });
});

/** PUT /api/conversations/:id/pins/:messageId — MSG-10. */
export const togglePin = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const { messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    const message = await Message.findOne({
      _id: messageId,
      conversationId: conversation._id,
      deletedAt: null,
    }).lean();
    if (!message) return res.status(404).json({ message: "Message not found." });

    const pinned = (conversation.pinnedMessageIds ?? []).some(
      (id) => String(id) === String(messageId)
    );

    await Conversation.updateOne(
      { _id: conversation._id },
      pinned
        ? { $pull: { pinnedMessageIds: new mongoose.Types.ObjectId(messageId) } }
        : { $addToSet: { pinnedMessageIds: new mongoose.Types.ObjectId(messageId) } }
    );

    await broadcastConversation(conversation._id);
    res.status(200).json({ pinned: !pinned });
});

/** GET /api/conversations/:id/media — MED-07, paginated. */
export const listConversationMedia = asyncHandler(async (req, res) => {
    const { conversation } = req;
    const limit = Math.min(Number(req.query.limit) || 30, 60);
    const before = req.query.before ? new Date(req.query.before) : null;

    if (before && Number.isNaN(before.getTime())) {
      return res.status(400).json({ message: "Invalid cursor." });
    }

    const filter = {
      conversationId: conversation._id,
      deletedAt: null,
      $or: [{ attachment: { $ne: null } }, { image: { $exists: true, $ne: null } }],
    };
    if (before) filter.createdAt = { $lt: before };

    const page = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .select("attachment image createdAt senderId")
      .lean();

    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;

    res.status(200).json({
      items,
      hasMore,
      nextCursor: items.length > 0 ? items.at(-1).createdAt : null,
    });
});
