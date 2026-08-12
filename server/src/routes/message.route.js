import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { getAllContacts, getChatPartners, getMessagesByUserId, markConversationAsRead, sendMessage } from "../controller/message.controller.js";

const messageRouter = express.Router();


messageRouter.use(arcjetProtection,protectRoute)


messageRouter.get("/contacts", getAllContacts);
messageRouter.get("/chats", getChatPartners);
// specific paths before the /:id catch-all, so a future GET /read/:id cannot be
// swallowed by it
messageRouter.patch("/read/:id", markConversationAsRead);
messageRouter.get("/:id", getMessagesByUserId);
messageRouter.post("/send/:id", sendMessage);


export default messageRouter;