import express from "express";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import {
  listAuditEvents,
  listClientErrors,
  getOverview,
} from "../controller/admin.controller.js";

const adminRouter = express.Router();

// requireAdmin at the router level, so a route added later cannot be left
// unguarded by omission
adminRouter.use(arcjetProtection, protectRoute, requireAdmin);

adminRouter.get("/overview", getOverview);
adminRouter.get("/audit", listAuditEvents);
adminRouter.get("/errors", listClientErrors);

export default adminRouter;
