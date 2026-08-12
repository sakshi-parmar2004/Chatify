import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { recordClientError } from "../controller/logs.controller.js";

const logsRouter = express.Router();

logsRouter.use(arcjetProtection, protectRoute);
logsRouter.post("/client", recordClientError);

export default logsRouter;
