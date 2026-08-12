import mongoose from "mongoose";

/** NTF-01 — one browser's push endpoint. A user may have several devices. */
const pushSubscriptionSchema = new mongoose.Schema(
    {
        endpoint: { type: String, required: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
        },
        // so a stale subscription can be pruned rather than retried forever
        failureCount: { type: Number, default: 0 },
    },
    { _id: false }
);

/**
 * NTF-05 — an account-level quiet period.
 *
 * Stored as minutes-since-midnight plus an IANA timezone rather than absolute
 * times: the user carries their timezone with them, and a window stored as UTC
 * would drift every time they travelled.
 */
const doNotDisturbSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        startMinute: { type: Number, default: 22 * 60, min: 0, max: 1439 },
        endMinute: { type: Number, default: 7 * 60, min: 0, max: 1439 },
        timezone: { type: String, default: "UTC" },
    },
    { _id: false }
);

//created a schema for the user model
const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        // lowercase + trim keep "Alice@Example.com " and "alice@example.com"
        // from becoming two accounts that can't log into each other
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true  , minlength: 6 },
        profilePic: { type: String, default: "" },
        pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
        doNotDisturb: { type: doNotDisturbSchema, default: () => ({}) },
        // NTF-03 — so a digest never covers the same messages twice
        lastDigestAt: { type: Date, default: null },
        // NTF-07. Deliberately coarse: rounded to the minute when read, so it
        // cannot be used to watch someone's activity second by second.
        lastSeenAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Defence in depth: even if a route forgets .select("-password"), the hash can
// never be serialised into a response.
UserSchema.set("toJSON", {
    transform: (_doc, ret) => {
        delete ret.password;
        // endpoints are per-device capability URLs; nothing in the UI needs them
        delete ret.pushSubscriptions;
        return ret;
    },
});

// Create a model from the schema which will be used to interact with the database
const User = mongoose.model("User", UserSchema);
export default User;
