import mongoose from "mongoose";
import { asyncHandler } from "../lib/asyncHandler.js";
import Conversation from "../models/conversation.model.js";

/**
 * Load the conversation named by :id and prove the caller is in it.
 *
 * Every conversation route goes through this, so membership is checked in one
 * place rather than remembered at each call site. It answers 404 rather than
 * 403 for a conversation the caller is not part of: telling someone a
 * conversation exists but is not theirs is itself a disclosure.
 */
export const loadConversation = asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid conversation id." });
    }

    const conversation = await Conversation.findById(id).lean();
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    const isParticipant = conversation.participants.some(
      (participantId) => String(participantId) === String(req.user._id)
    );
    if (!isParticipant) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    req.conversation = conversation;
    next();
});

/** Group operations that only an admin may perform (GRP-02). */
export const requireGroupAdmin = (req, res, next) => {
  const { conversation } = req;

  if (conversation.type !== "group") {
    return res.status(400).json({ message: "Not a group conversation." });
  }

  const isAdmin = (conversation.admins ?? []).some(
    (adminId) => String(adminId) === String(req.user._id)
  );
  if (!isAdmin) {
    return res.status(403).json({ message: "Only an admin can do that." });
  }

  next();
};
