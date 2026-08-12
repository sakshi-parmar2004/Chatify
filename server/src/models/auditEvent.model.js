import mongoose from "mongoose";

/**
 * The activity log (OBS-02).
 *
 * Structured and queryable, unlike the free-text system messages in a
 * conversation. Those stay: they are in-band and user-visible, and they answer
 * "what happened in this chat". This answers "what happened to my account", and
 * is what the operator view reads (OBS-04).
 *
 * There is deliberately no field for message content. That is what makes
 * "an admin cannot read your messages" a property of the schema rather than of
 * a filter someone has to remember to apply.
 */
export const AUDIT_ACTIONS = [
  // account
  "user.register", "user.login", "user.logout", "user.profile_updated",
  "user.preferences_updated", "user.push_subscribed", "user.push_unsubscribed",
  "user.dnd_updated", "user.role_granted",
  // conversations
  "conversation.created", "conversation.wallpaper_set",
  // groups
  "group.created", "group.renamed", "group.member_added", "group.member_removed",
  "group.member_left", "group.admin_granted", "group.admin_revoked",
  // messages — the fact, never the content
  "message.deleted", "message.edited",
];

// Ninety days. Long enough to investigate something a user reports weeks later,
// short enough that the collection does not become the largest thing in the
// database. A TTL index means retention is enforced by MongoDB rather than by a
// cleanup job somebody has to remember to run.
export const AUDIT_TTL_DAYS = 90;

const auditEventSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    // what was acted on — a user, a conversation, a message
    targetType: { type: String, enum: ["user", "conversation", "message", null], default: null },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
    /**
     * Small, structured extras — a group name, a theme id, a member count.
     * Never message text, never an attachment URL. Bounded on write.
     */
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    // for "you were logged in from somewhere new"; coarse by design
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// "my activity, newest first" — the only query the user-facing view makes
auditEventSchema.index({ actorId: 1, createdAt: -1 });
// the operator view filters by action and by time
auditEventSchema.index({ action: 1, createdAt: -1 });
auditEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_TTL_DAYS * 24 * 60 * 60 });

const AuditEvent = mongoose.model("AuditEvent", auditEventSchema);

export default AuditEvent;
