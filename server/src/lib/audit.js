import AuditEvent from "../models/auditEvent.model.js";
import { log } from "./logger.js";

/**
 * The single writer for audit events (OBS-02).
 *
 * One function rather than `AuditEvent.create` scattered across twenty
 * controllers, so the bounds below are applied everywhere and the taxonomy has
 * one place to change.
 *
 * Never awaited by a request path and never able to fail one: an audit write
 * that 500s someone's message send is a worse outcome than a missing audit row.
 */

// Metadata is a convenience, not a payload. Bounded so a controller cannot
// accidentally pass a whole document — which is how message content would end
// up in a collection that promises not to hold any.
const MAX_METADATA_KEYS = 12;
const MAX_VALUE_LENGTH = 200;

const sanitizeMetadata = (metadata = {}) => {
  const clean = {};

  for (const [key, value] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "string") clean[key] = value.slice(0, MAX_VALUE_LENGTH);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
    else clean[key] = String(value).slice(0, MAX_VALUE_LENGTH);
  }

  return clean;
};

/** Coarse on purpose — enough to say "somewhere new", not to track someone. */
const clientIp = (req) =>
  (req?.headers?.["x-forwarded-for"]?.split(",")[0] || req?.socket?.remoteAddress || "")
    .trim()
    .slice(0, 45) || null;

export const recordEvent = ({
  actorId,
  action,
  targetType = null,
  targetId = null,
  conversationId = null,
  metadata = {},
  req = null,
}) => {
  if (!actorId || !action) return;

  AuditEvent.create({
    actorId,
    action,
    targetType,
    targetId,
    conversationId,
    metadata: sanitizeMetadata(metadata),
    ip: req ? clientIp(req) : null,
    userAgent: req?.headers?.["user-agent"]?.slice(0, 255) ?? null,
  }).catch((error) => {
    // never surfaced to the caller — see above
    log.warn({ err: error, action }, "audit write failed");
  });
};
