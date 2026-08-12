import mongoose from "mongoose";

/**
 * Client error reports (OBS-03).
 *
 * Deduplicated by fingerprint: one broken render loop would otherwise write a
 * row per frame. A repeat increments a count and moves `lastSeenAt`, which also
 * makes "how often" answerable without scanning.
 */
export const CLIENT_ERROR_TTL_DAYS = 30;

const clientErrorSchema = new mongoose.Schema(
  {
    // hash of message + top stack frame; stable across occurrences
    fingerprint: { type: String, required: true, index: true },
    message: { type: String, required: true, maxlength: 500 },
    stack: { type: String, default: "", maxlength: 4000 },
    componentStack: { type: String, default: "", maxlength: 4000 },
    // pathname only — a query string or hash carries ids
    path: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    kind: { type: String, enum: ["render", "window", "rejection"], default: "render" },

    count: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    // who hit it, for reproduction — never what they were saying
    lastActorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    affectedUsers: { type: Number, default: 1 },
  },
  { timestamps: false }
);

clientErrorSchema.index({ lastSeenAt: -1 });
clientErrorSchema.index(
  { lastSeenAt: 1 },
  { expireAfterSeconds: CLIENT_ERROR_TTL_DAYS * 24 * 60 * 60 }
);

const ClientError = mongoose.model("ClientError", clientErrorSchema);

export default ClientError;
