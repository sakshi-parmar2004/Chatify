import { asyncHandler } from "../lib/asyncHandler.js";
import AuditEvent, { AUDIT_ACTIONS, AUDIT_TTL_DAYS } from "../models/auditEvent.model.js";
import ClientError, { CLIENT_ERROR_TTL_DAYS } from "../models/clientError.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";

const MAX_PAGE = 100;
const DEFAULT_PAGE = 50;

/**
 * Cursor pagination, matching listMessages: `before` is a timestamp, and one
 * extra row answers "is there more" without a count.
 */
const paginate = (req) => {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE, MAX_PAGE);
  const before = req.query.before ? new Date(req.query.before) : null;
  if (before && Number.isNaN(before.getTime())) return { error: "Invalid cursor." };
  return { limit, before };
};

/**
 * GET /api/admin/audit
 *
 * Reads the AuditEvent collection — never a log file. A file-read endpoint on a
 * production server is a path-traversal target and would expose whatever
 * redaction missed; this collection has no field for message content, so there
 * is nothing here to leak (DEC-12).
 */
export const listAuditEvents = asyncHandler(async (req, res) => {
  const { limit, before, error } = paginate(req);
  if (error) return res.status(400).json({ message: error });

  const filter = {};
  if (before) filter.createdAt = { $lt: before };

  if (req.query.action) {
    if (!AUDIT_ACTIONS.includes(req.query.action)) {
      return res.status(400).json({ message: "Unknown action." });
    }
    filter.action = req.query.action;
  }
  if (req.query.actorId) {
    if (!mongoose.Types.ObjectId.isValid(req.query.actorId)) {
      return res.status(400).json({ message: "Invalid actor id." });
    }
    filter.actorId = req.query.actorId;
  }

  const page = await AuditEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = page.length > limit;
  const events = hasMore ? page.slice(0, limit) : page;

  // names, so the view is readable without a second round trip per row
  const actors = await User.find({ _id: { $in: events.map((e) => e.actorId) } })
    .select("name email")
    .lean();
  const actorById = new Map(actors.map((user) => [String(user._id), user]));

  res.status(200).json({
    events: events.map((event) => ({
      ...event,
      actor: actorById.get(String(event.actorId)) ?? null,
    })),
    hasMore,
    nextCursor: events.length > 0 ? events.at(-1).createdAt : null,
  });
});

/** GET /api/admin/errors — OBS-03 reports, most recent first. */
export const listClientErrors = asyncHandler(async (req, res) => {
  const { limit, before, error } = paginate(req);
  if (error) return res.status(400).json({ message: error });

  const filter = before ? { lastSeenAt: { $lt: before } } : {};

  const page = await ClientError.find(filter)
    .sort({ lastSeenAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = page.length > limit;
  const errors = hasMore ? page.slice(0, limit) : page;

  res.status(200).json({
    errors,
    hasMore,
    nextCursor: errors.length > 0 ? errors.at(-1).lastSeenAt : null,
  });
});

/**
 * GET /api/admin/overview — counts only.
 *
 * Deliberately not a message or conversation count: an operator has no reason
 * to know how much any individual is talking, and a total invites the next
 * request being "by user".
 */
export const getOverview = asyncHandler(async (_req, res) => {
  const [users, admins, events, errors] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "admin" }),
    AuditEvent.countDocuments({}),
    ClientError.countDocuments({}),
  ]);

  res.status(200).json({
    users,
    admins,
    auditEvents: events,
    clientErrors: errors,
    retention: { auditDays: AUDIT_TTL_DAYS, errorDays: CLIENT_ERROR_TTL_DAYS },
  });
});
