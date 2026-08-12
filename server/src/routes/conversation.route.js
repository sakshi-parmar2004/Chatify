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

const conversationRouter = express.Router();

conversationRouter.use(arcjetProtection, protectRoute);

conversationRouter.get("/", listConversations);
// specific paths before anything that takes an :id, always
conversationRouter.post("/direct/:userId", openDirectConversation);

conversationRouter.get("/:id/messages", loadConversation, listMessages);
conversationRouter.post("/:id/messages", loadConversation, createMessage);
conversationRouter.patch("/:id/read", loadConversation, markConversationRead);

export default conversationRouter;
