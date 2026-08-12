import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { loadConversation } from "../middleware/conversation.middleware.js";
import {
  listConversations,
  openDirectConversation,
  listMessages,
  markConversationRead,
  createMessage,
} from "../controller/conversation.controller.js";
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
conversationRouter.post("/direct/:userId", openDirectConversation);

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

export default conversationRouter;
