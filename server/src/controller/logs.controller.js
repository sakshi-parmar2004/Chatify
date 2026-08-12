import { createHash } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler.js";
import ClientError from "../models/clientError.model.js";
import { log } from "../lib/logger.js";

/**
 * POST /api/logs/client — OBS-03.
 *
 * Authenticated. An open endpoint here is a spam magnet with a database behind
 * it, and the reports are only useful with a user attached anyway.
 *
 * The caps below are the point of this handler. A render loop that throws every
 * frame will happily send thousands of reports a second, so:
 *   - fields are truncated on write, not trusted
 *   - identical errors deduplicate onto one row with a count
 *   - a per-user budget stops one broken tab filling the collection
 */
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_PATH = 200;

// Per user, per window. Generous enough for a genuinely broken page, small
// enough that it cannot be used as a write primitive.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map();

const withinBudget = (userId) => {
  const now = Date.now();
  const key = String(userId);
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.startedAt > RATE_WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;

  bucket.count += 1;
  return true;
};

/**
 * A component stack is a list of component names, but React includes source
 * paths and a thrown error's message can contain anything the app put in it.
 * Only keep lines that look like frames.
 */
const cleanStack = (stack) =>
  String(stack ?? "")
    .split("\n")
    .filter((line) => /^\s*(at |in )/.test(line))
    .slice(0, 30)
    .join("\n")
    .slice(0, MAX_STACK);

/** Stable across occurrences, so repeats collapse onto one row. */
const fingerprintOf = (message, stack) =>
  createHash("sha256")
    .update(`${message}\n${stack.split("\n")[0] ?? ""}`)
    .digest("hex")
    .slice(0, 32);

export const recordClientError = asyncHandler(async (req, res) => {
  if (!withinBudget(req.user._id)) {
    // 202 rather than 429: the client must not retry, and a failed error report
    // is never worth surfacing to the person using the app
    return res.status(202).json({ recorded: false });
  }

  const { message, stack, componentStack, path, kind } = req.body ?? {};

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ message: "A message is required." });
  }

  const cleanMessage = message.slice(0, MAX_MESSAGE);
  const cleanedStack = cleanStack(stack);
  const fingerprint = fingerprintOf(cleanMessage, cleanedStack);
  const now = new Date();

  const existing = await ClientError.findOne({ fingerprint }).select("lastActorId").lean();
  const isNewUser = existing && String(existing.lastActorId) !== String(req.user._id);

  await ClientError.updateOne(
    { fingerprint },
    {
      $set: {
        message: cleanMessage,
        stack: cleanedStack,
        componentStack: cleanStack(componentStack),
        // pathname only — a query string or hash carries conversation ids
        path: String(path ?? "").split(/[?#]/)[0].slice(0, MAX_PATH),
        userAgent: req.headers["user-agent"]?.slice(0, 255) ?? "",
        kind: ["render", "window", "rejection"].includes(kind) ? kind : "render",
        lastSeenAt: now,
        lastActorId: req.user._id,
      },
      $inc: { count: 1, ...(isNewUser ? { affectedUsers: 1 } : {}) },
      $setOnInsert: { firstSeenAt: now },
    },
    { upsert: true }
  );

  log.warn(
    { fingerprint, clientMessage: cleanMessage, path, userId: String(req.user._id) },
    "client error reported"
  );

  res.status(201).json({ recorded: true });
});
