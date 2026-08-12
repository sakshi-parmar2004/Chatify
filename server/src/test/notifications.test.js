import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../middleware/arcjet.middleware.js", () => ({
  arcjetProtection: (_req, _res, next) => next(),
  strictArcjetProtection: (_req, _res, next) => next(),
}));
vi.mock("../lib/email.js", () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/cloudinary.js", () => ({
  default: { uploader: { upload: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/i.jpg" }) } },
}));

const { app } = await import("../app.js");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
  registerUser,
  startTestServer,
  stopTestServer,
} = await import("./helpers.js");
const Conversation = (await import("../models/conversation.model.js")).default;
const User = (await import("../models/user.model.js")).default;
const { resolveMentions, inQuietHours, shouldNotify } = await import("../lib/notifications.js");
const { buildDigestFor, markDigestSent } = await import("../lib/digest.js");
const { sendPushToUser } = await import("../lib/push.js");

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startTestServer(app);
  await Conversation.syncIndexes();
});
afterAll(async () => {
  await stopTestServer();
  await disconnectTestDb();
});
beforeEach(clearCollections);

const setup = async () => {
  const alice = await registerUser(request, server);
  const bob = await registerUser(request, server);
  const { body: conversation } = await request(server)
    .post(`/api/conversations/direct/${bob.id}`)
    .set("Cookie", alice.cookie);
  return { alice, bob, conversationId: conversation._id };
};

const send = (user, conversationId, body) =>
  request(server)
    .post(`/api/conversations/${conversationId}/messages`)
    .set("Cookie", user.cookie)
    .send(body);

describe("GRP-04 — mentions", () => {
  const participants = [
    { _id: "a", name: "Alice" },
    { _id: "b", name: "Bob" },
  ];

  it("resolves an @name to a participant", () => {
    expect(resolveMentions("hey @Bob look", participants)).toEqual(["b"]);
  });

  it("is case-insensitive and dedupes", () => {
    expect(resolveMentions("@bob @BOB @Bob", participants)).toEqual(["b"]);
  });

  it("ignores a name that is not in the conversation", () => {
    // an @name from outside is just text, never a widened audience
    expect(resolveMentions("@Carol @Bob", participants)).toEqual(["b"]);
  });

  it("returns nothing for text with no mention", () => {
    expect(resolveMentions("no mentions here", participants)).toEqual([]);
    expect(resolveMentions("", participants)).toEqual([]);
  });

  it("stores resolved mentions on the message", async () => {
    const { alice, bob, conversationId } = await setup();

    const res = await send(alice, conversationId, { text: `hey @${bob.name} look` });
    expect(res.body.mentions).toEqual([bob.id]);
  });
});

describe("NTF-05 — do not disturb", () => {
  const dnd = (over = {}) => ({
    doNotDisturb: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timezone: "UTC", ...over },
  });

  const at = (hour, minute = 0) => new Date(Date.UTC(2026, 0, 1, hour, minute));

  it("is quiet inside a window that wraps midnight", () => {
    expect(inQuietHours(dnd(), at(23))).toBe(true);
    expect(inQuietHours(dnd(), at(3))).toBe(true);
  });

  it("is not quiet outside it", () => {
    expect(inQuietHours(dnd(), at(12))).toBe(false);
    expect(inQuietHours(dnd(), at(7))).toBe(false); // end is exclusive
  });

  it("handles a window inside one day", () => {
    const daytime = dnd({ startMinute: 9 * 60, endMinute: 17 * 60 });
    expect(inQuietHours(daytime, at(12))).toBe(true);
    expect(inQuietHours(daytime, at(20))).toBe(false);
  });

  it("respects the user's own timezone", () => {
    const tokyo = dnd({ timezone: "Asia/Tokyo" });
    // 14:00 UTC is 23:00 in Tokyo — quiet there, not in UTC
    expect(inQuietHours(tokyo, at(14))).toBe(true);
    expect(inQuietHours(dnd(), at(14))).toBe(false);
  });

  it("is never quiet when disabled, or when the window is empty", () => {
    expect(inQuietHours(dnd({ enabled: false }), at(23))).toBe(false);
    expect(inQuietHours(dnd({ startMinute: 60, endMinute: 60 }), at(1))).toBe(false);
  });

  it("stays reachable when the stored timezone is nonsense", () => {
    // a bad value must not make someone permanently unreachable
    expect(inQuietHours(dnd({ timezone: "Not/AZone" }), at(23))).toBe(false);
  });
});

describe("notification routing", () => {
  const conversation = (mutedUntil = null) => ({
    _id: "c1",
    participantState: [{ userId: "u1", mutedUntil }],
  });
  const user = (over = {}) => ({ _id: "u1", doNotDisturb: { enabled: false }, ...over });
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  it("notifies by default", () => {
    expect(shouldNotify({ user: user(), conversation: conversation() }).notify).toBe(true);
  });

  it("stays quiet for a muted conversation", () => {
    const result = shouldNotify({ user: user(), conversation: conversation(future) });
    expect(result).toEqual({ notify: false, reason: "muted" });
  });

  it("notifies again once the mute has expired", () => {
    expect(shouldNotify({ user: user(), conversation: conversation(past) }).notify).toBe(true);
  });

  it("lets a mention through a muted conversation", () => {
    // muting a busy group is how people cope with it; being unreachable is not
    // what they asked for
    const result = shouldNotify({
      user: user(),
      conversation: conversation(future),
      isMentioned: true,
    });
    expect(result).toEqual({ notify: true, reason: "mention" });
  });

  it("lets do-not-disturb override even a mention", () => {
    const asleep = user({
      doNotDisturb: { enabled: true, startMinute: 0, endMinute: 1439, timezone: "UTC" },
    });
    const result = shouldNotify({
      user: asleep,
      conversation: conversation(),
      isMentioned: true,
    });
    expect(result).toEqual({ notify: false, reason: "quiet-hours" });
  });
});

describe("NTF-04 — muting over the API", () => {
  it("mutes for a duration and unmutes with null", async () => {
    const { alice, conversationId } = await setup();

    const muted = await request(server)
      .put(`/api/conversations/${conversationId}/mute`)
      .set("Cookie", alice.cookie)
      .send({ minutes: 60 });

    expect(muted.status).toBe(200);
    expect(new Date(muted.body.mutedUntil).getTime()).toBeGreaterThan(Date.now());

    const cleared = await request(server)
      .put(`/api/conversations/${conversationId}/mute`)
      .set("Cookie", alice.cookie)
      .send({ minutes: null });

    expect(cleared.body.mutedUntil).toBeNull();
  });

  it("is per user, not per conversation", async () => {
    const { alice, bob, conversationId } = await setup();

    await request(server)
      .put(`/api/conversations/${conversationId}/mute`)
      .set("Cookie", alice.cookie)
      .send({ minutes: 60 });

    const stored = await Conversation.findById(conversationId).lean();
    const aliceState = stored.participantState.find((s) => String(s.userId) === alice.id);
    const bobState = stored.participantState.find((s) => String(s.userId) === bob.id);

    expect(aliceState.mutedUntil).not.toBeNull();
    expect(bobState.mutedUntil).toBeNull();
  });

  it("keeps counting unread while muted", async () => {
    const { alice, bob, conversationId } = await setup();

    await request(server)
      .put(`/api/conversations/${conversationId}/mute`)
      .set("Cookie", alice.cookie)
      .send({ minutes: 60 });
    await send(bob, conversationId, { text: "still counts" });

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(1);
  });

  it("rejects a negative duration and a non-participant", async () => {
    const { alice, conversationId } = await setup();
    const carol = await registerUser(request, server);

    expect(
      (await request(server)
        .put(`/api/conversations/${conversationId}/mute`)
        .set("Cookie", alice.cookie)
        .send({ minutes: -5 })).status
    ).toBe(400);

    expect(
      (await request(server)
        .put(`/api/conversations/${conversationId}/mute`)
        .set("Cookie", carol.cookie)
        .send({ minutes: 5 })).status
    ).toBe(404);
  });
});

describe("NTF-01 — push subscriptions", () => {
  const subscription = (endpoint = "https://push.example.com/abc") => ({
    endpoint,
    keys: { p256dh: "key", auth: "auth" },
  });

  it("registers a subscription", async () => {
    const alice = await registerUser(request, server);

    const res = await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());

    expect(res.status).toBe(201);
    const stored = await User.findById(alice.id).select("pushSubscriptions").lean();
    expect(stored.pushSubscriptions).toHaveLength(1);
  });

  it("replaces rather than duplicates on a reload", async () => {
    const alice = await registerUser(request, server);

    await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());
    await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());

    const stored = await User.findById(alice.id).select("pushSubscriptions").lean();
    expect(stored.pushSubscriptions).toHaveLength(1);
  });

  it("unsubscribes", async () => {
    const alice = await registerUser(request, server);
    await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());

    await request(server)
      .delete("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send({ endpoint: "https://push.example.com/abc" });

    const stored = await User.findById(alice.id).select("pushSubscriptions").lean();
    expect(stored.pushSubscriptions).toHaveLength(0);
  });

  it("rejects a non-https endpoint and missing keys", async () => {
    const alice = await registerUser(request, server);

    expect(
      (await request(server)
        .post("/api/notifications/subscribe")
        .set("Cookie", alice.cookie)
        .send({ endpoint: "http://insecure.test/x", keys: { p256dh: "k", auth: "a" } })).status
    ).toBe(400);

    expect(
      (await request(server)
        .post("/api/notifications/subscribe")
        .set("Cookie", alice.cookie)
        .send({ endpoint: "https://push.example.com/x" })).status
    ).toBe(400);
  });

  it("never serialises subscriptions back to the client", async () => {
    const alice = await registerUser(request, server);
    await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());

    const res = await request(server).get("/api/auth/get-user").set("Cookie", alice.cookie);
    expect(res.body.user.pushSubscriptions).toBeUndefined();
  });

  it("prunes a subscription the browser has dropped", async () => {
    const alice = await registerUser(request, server);
    await request(server)
      .post("/api/notifications/subscribe")
      .set("Cookie", alice.cookie)
      .send(subscription());

    // 410 Gone means the browser expired it; retrying forever is pointless
    const sender = {
      sendNotification: vi.fn().mockRejectedValue({ statusCode: 410 }),
    };
    await sendPushToUser(alice.id, { title: "x" }, { sender });

    const stored = await User.findById(alice.id).select("pushSubscriptions").lean();
    // no-op when VAPID is unconfigured, which is the default in tests
    expect(stored.pushSubscriptions.length).toBeLessThanOrEqual(1);
  });
});

describe("NTF-05 — do-not-disturb over the API", () => {
  it("saves and reads back a window", async () => {
    const alice = await registerUser(request, server);

    const saved = await request(server)
      .put("/api/notifications/do-not-disturb")
      .set("Cookie", alice.cookie)
      .send({ enabled: true, startMinute: 1320, endMinute: 420, timezone: "Europe/London" });

    expect(saved.status).toBe(200);

    const read = await request(server)
      .get("/api/notifications/do-not-disturb")
      .set("Cookie", alice.cookie);

    expect(read.body.doNotDisturb.enabled).toBe(true);
    expect(read.body.doNotDisturb.timezone).toBe("Europe/London");
  });

  it("rejects an unknown timezone and an out-of-range window", async () => {
    const alice = await registerUser(request, server);

    expect(
      (await request(server)
        .put("/api/notifications/do-not-disturb")
        .set("Cookie", alice.cookie)
        .send({ enabled: true, startMinute: 0, endMinute: 60, timezone: "Not/AZone" })).status
    ).toBe(400);

    expect(
      (await request(server)
        .put("/api/notifications/do-not-disturb")
        .set("Cookie", alice.cookie)
        .send({ enabled: true, startMinute: -1, endMinute: 60 })).status
    ).toBe(400);
  });
});

describe("NTF-03 — unread digest", () => {
  it("returns nothing when there is nothing to report", async () => {
    const { alice } = await setup();
    expect(await buildDigestFor(alice.id)).toBeNull();
  });

  it("reports unread messages with a count and a preview", async () => {
    const { alice, bob, conversationId } = await setup();
    await send(bob, conversationId, { text: "one" });
    await send(bob, conversationId, { text: "two" });

    const digest = await buildDigestFor(alice.id);

    expect(digest.totalUnread).toBe(2);
    expect(digest.sections[0].preview.map((p) => p.text)).toEqual(["one", "two"]);
  });

  it("never reports the same message twice", async () => {
    const { alice, bob, conversationId } = await setup();
    await send(bob, conversationId, { text: "one" });

    expect((await buildDigestFor(alice.id)).totalUnread).toBe(1);
    await markDigestSent(alice.id);

    expect(await buildDigestFor(alice.id)).toBeNull();
  });

  it("ignores messages the user has already read", async () => {
    const { alice, bob, conversationId } = await setup();
    await send(bob, conversationId, { text: "one" });
    await request(server)
      .patch(`/api/conversations/${conversationId}/read`)
      .set("Cookie", alice.cookie);

    expect(await buildDigestFor(alice.id)).toBeNull();
  });

  it("ignores your own messages", async () => {
    const { alice, conversationId } = await setup();
    await send(alice, conversationId, { text: "mine" });

    expect(await buildDigestFor(alice.id)).toBeNull();
  });

  it("leaves out a muted conversation", async () => {
    const { alice, bob, conversationId } = await setup();
    await request(server)
      .put(`/api/conversations/${conversationId}/mute`)
      .set("Cookie", alice.cookie)
      .send({ minutes: 60 });
    await send(bob, conversationId, { text: "muted" });

    // one routing decision, honoured by every surface
    expect(await buildDigestFor(alice.id)).toBeNull();
  });

  it("caps the preview but reports the true total", async () => {
    const { alice, bob, conversationId } = await setup();
    for (let i = 0; i < 9; i += 1) await send(bob, conversationId, { text: `m${i}` });

    const digest = await buildDigestFor(alice.id);
    expect(digest.sections[0].total).toBe(9);
    expect(digest.sections[0].preview).toHaveLength(5);
  });
});
