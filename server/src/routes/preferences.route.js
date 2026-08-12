import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  getPreferences,
  updatePreferences,
  listMyActivity,
} from "../controller/preferences.controller.js";

const preferencesRouter = express.Router();

preferencesRouter.use(arcjetProtection, protectRoute);

preferencesRouter.get("/", getPreferences);
preferencesRouter.put("/", updatePreferences);
preferencesRouter.get("/activity", listMyActivity);

export default preferencesRouter;
