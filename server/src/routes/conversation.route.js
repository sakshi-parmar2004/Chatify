import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { loadConversation, requireGroupAdmin } from "../middleware/conversation.middleware.js";
import {
  listConversations,
  openDirectConversation,
  listMessages,
  markConversationRead,
  createMessage,
} from "../controller/conversation.controller.js";
import { createUploadSignature } from "../controller/upload.controller.js";
import { muteConversation } from "../controller/notification.controller.js";
import {
  createGroup,
  updateGroup,
  addParticipants,
  removeParticipant,
  promoteToAdmin,
  demoteAdmin,
  togglePin,
  listConversationMedia,
} from "../controller/group.controller.js";
import {
  editMessage,
  deleteMessage,
  toggleReaction,
  searchMessages,
} from "../controller/message.actions.controller.js";

const conversationRouter = express.Router();

conversationRouter.use(arcjetProtection, protectRoute);

// Specific paths before anything that takes an :id, always — otherwise "search"
// and "direct" are read as conversation ids.
conversationRouter.get("/search", searchMessages);
// MED-01 — issues a narrow, short-lived Cloudinary signature; the file itself
// never touches this server
conversationRouter.post("/uploads/sign", createUploadSignature);
conversationRouter.post("/direct/:userId", openDirectConversation);
conversationRouter.post("/groups", createGroup);

conversationRouter.get("/", listConversations);

conversationRouter.get("/:id/messages", loadConversation, listMessages);
conversationRouter.post("/:id/messages", loadConversation, createMessage);
conversationRouter.patch("/:id/read", loadConversation, markConversationRead);

conversationRouter.patch("/:id/messages/:messageId", loadConversation, editMessage);
conversationRouter.delete("/:id/messages/:messageId", loadConversation, deleteMessage);
conversationRouter.put(
  "/:id/messages/:messageId/reactions",
  loadConversation,
  toggleReaction
);

// GRP-02 — admin-only operations. requireGroupAdmin runs after loadConversation
// has already proved membership.
conversationRouter.patch("/:id/group", loadConversation, requireGroupAdmin, updateGroup);
conversationRouter.post("/:id/participants", loadConversation, requireGroupAdmin, addParticipants);
// not admin-gated: removing yourself is leaving, and the controller separates
// the two cases
conversationRouter.delete("/:id/participants/:userId", loadConversation, removeParticipant);
conversationRouter.put("/:id/admins/:userId", loadConversation, requireGroupAdmin, promoteToAdmin);
conversationRouter.delete("/:id/admins/:userId", loadConversation, requireGroupAdmin, demoteAdmin);

conversationRouter.put("/:id/pins/:messageId", loadConversation, togglePin);
conversationRouter.get("/:id/media", loadConversation, listConversationMedia);
conversationRouter.put("/:id/mute", loadConversation, muteConversation);

export default conversationRouter;
