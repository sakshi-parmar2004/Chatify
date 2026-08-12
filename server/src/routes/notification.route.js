import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  getPushConfig,
  subscribeToPush,
  unsubscribeFromPush,
  getDoNotDisturb,
  updateDoNotDisturb,
} from "../controller/notification.controller.js";

const notificationRouter = express.Router();

notificationRouter.use(arcjetProtection, protectRoute);

notificationRouter.get("/config", getPushConfig);
notificationRouter.post("/subscribe", subscribeToPush);
notificationRouter.delete("/subscribe", unsubscribeFromPush);
notificationRouter.get("/do-not-disturb", getDoNotDisturb);
notificationRouter.put("/do-not-disturb", updateDoNotDisturb);

export default notificationRouter;
