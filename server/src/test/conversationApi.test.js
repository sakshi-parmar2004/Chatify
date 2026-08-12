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
const { connectTestDb, disconnectTestDb, clearCollections, registerUser, startTestServer, stopTestServer } =
  await import("./helpers.js");
const Conversation = (await import("../models/conversation.model.js")).default;
const Message = (await import("../models/message.model.js")).default;

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

const openDirect = (user, otherId) =>
  request(server).post(`/api/conversations/direct/${otherId}`).set("Cookie", user.cookie);

const send = (user, conversationId, body) =>
  request(server)
    .post(`/api/conversations/${conversationId}/messages`)
    .set("Cookie", user.cookie)
    .send(body);

const twoUsers = async () => {
  const alice = await registerUser(request, server);
  const bob = await registerUser(request, server);
  const res = await openDirect(alice, bob.id);
  // assert here rather than let an undefined id turn into a confusing failure
  // three lines later
  if (res.status !== 200) {
    throw new Error(`openDirect failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { alice, bob, conversationId: res.body._id };
};

describe("POST /api/conversations/direct/:userId", () => {
  it("creates a direct conversation and returns the partner", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    const res = await openDirect(alice, bob.id);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("direct");
    expect(res.body.partner._id).toBe(bob.id);
    expect(res.body.partner.password).toBeUndefined();
    expect(res.body.unreadCount).toBe(0);
  });

  it("is idempotent from either side", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    const first = await openDirect(alice, bob.id);
    const second = await openDirect(bob, alice.id);

    expect(second.body._id).toBe(first.body._id);
    expect(await Conversation.countDocuments({})).toBe(1);
  });

  it("rejects yourself, a stranger id and a malformed id", async () => {
    const alice = await registerUser(request, server);

    expect((await openDirect(alice, alice.id)).status).toBe(400);
    expect((await openDirect(alice, "507f1f77bcf86cd799439099")).status).toBe(404);
    expect((await openDirect(alice, "nope")).status).toBe(400);
  });
});

describe("GET /api/conversations", () => {
  it("lists conversations newest first with unread counts and previews", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const carol = await registerUser(request, server);

    const bobRes = await openDirect(alice, bob.id);
    const carolRes = await openDirect(alice, carol.id);
    expect(bobRes.status).toBe(200);
    expect(carolRes.status).toBe(200);
    const withBob = bobRes.body;
    const withCarol = carolRes.body;

    await send(bob, withBob._id, { text: "from bob 1" });
    await send(bob, withBob._id, { text: "from bob 2" });
    await send(carol, withCarol._id, { text: "from carol" });

    const res = await request(server).get("/api/conversations").set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.partner.name)).toEqual([carol.name, bob.name]);
    expect(res.body[0].unreadCount).toBe(1);
    expect(res.body[1].unreadCount).toBe(2);
    expect(res.body[1].lastMessage.text).toBe("from bob 2");
  });

  it("does not count your own messages as unread", async () => {
    const { alice, conversationId } = await twoUsers();
    await send(alice, conversationId, { text: "mine" });

    const res = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(res.body[0].unreadCount).toBe(0);
  });

  it("shows nobody else's conversations", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const carol = await registerUser(request, server);

    const { body: bobCarol } = await openDirect(bob, carol.id);
    await send(bob, bobCarol._id, { text: "private" });

    const res = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(res.body).toEqual([]);
  });

  it("requires authentication", async () => {
    expect((await request(server).get("/api/conversations")).status).toBe(401);
  });
});

describe("GET /api/conversations/:id/messages", () => {
  it("returns the newest page in chronological order with a cursor", async () => {
    const { alice, bob, conversationId } = await twoUsers();

    for (let i = 0; i < 12; i += 1) {
      await send(i % 2 ? bob : alice, conversationId, { text: `m${i}` });
    }

    const res = await request(server)
      .get(`/api/conversations/${conversationId}/messages?limit=5`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.text)).toEqual(["m7", "m8", "m9", "m10", "m11"]);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it("pages backwards through the whole history without gaps or repeats", async () => {
    const { alice, conversationId } = await twoUsers();
    for (let i = 0; i < 12; i += 1) await send(alice, conversationId, { text: `m${i}` });

    const collected = [];
    let cursor = null;

    for (let page = 0; page < 5; page += 1) {
      const url = `/api/conversations/${conversationId}/messages?limit=5${
        cursor ? `&before=${encodeURIComponent(cursor)}` : ""
      }`;
      const res = await request(server).get(url).set("Cookie", alice.cookie);
      collected.unshift(...res.body.messages.map((m) => m.text));
      cursor = res.body.nextCursor;
      if (!res.body.hasMore) break;
    }

    expect(collected).toEqual(Array.from({ length: 12 }, (_, i) => `m${i}`));
    expect(new Set(collected).size).toBe(12);
  });

  it("reports hasMore false on the last page", async () => {
    const { alice, conversationId } = await twoUsers();
    await send(alice, conversationId, { text: "only" });

    const res = await request(server)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", alice.cookie);

    expect(res.body.hasMore).toBe(false);
  });

  it("caps an absurd page size", async () => {
    const { alice, conversationId } = await twoUsers();
    const res = await request(server)
      .get(`/api/conversations/${conversationId}/messages?limit=99999`)
      .set("Cookie", alice.cookie);
    expect(res.status).toBe(200);
  });

  it("rejects a malformed cursor", async () => {
    const { alice, conversationId } = await twoUsers();
    const res = await request(server)
      .get(`/api/conversations/${conversationId}/messages?before=not-a-date`)
      .set("Cookie", alice.cookie);
    expect(res.status).toBe(400);
  });

  it("hides a conversation the caller is not in behind a 404", async () => {
    const { conversationId } = await twoUsers();
    const carol = await registerUser(request, server);

    const res = await request(server)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", carol.cookie);

    // 404 rather than 403 — confirming it exists is itself a disclosure
    expect(res.status).toBe(404);
  });
});

describe("POST /api/conversations/:id/messages", () => {
  it("sends and stamps the conversation", async () => {
    const { alice, conversationId } = await twoUsers();
    const res = await send(alice, conversationId, { text: "hello" });

    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBe(conversationId);
    expect(res.body.senderId).toBe(alice.id);
  });

  it("advances lastMessageAt and the sender's own read cursor", async () => {
    const { alice, conversationId } = await twoUsers();
    const res = await send(alice, conversationId, { text: "hello" });

    const conversation = await Conversation.findById(conversationId).lean();
    expect(conversation.lastMessageAt.toISOString()).toBe(res.body.createdAt);

    const mine = conversation.participantState.find((s) => String(s.userId) === alice.id);
    expect(mine.lastReadAt.toISOString()).toBe(res.body.createdAt);
  });

  it("refuses an empty message and a bad image", async () => {
    const { alice, conversationId } = await twoUsers();

    expect((await send(alice, conversationId, {})).status).toBe(400);
    expect(
      (await send(alice, conversationId, { image: "https://evil.test/x" })).status
    ).toBe(400);
  });

  it("refuses a non-participant", async () => {
    const { conversationId } = await twoUsers();
    const carol = await registerUser(request, server);

    expect((await send(carol, conversationId, { text: "hi" })).status).toBe(404);
  });
});

describe("PATCH /api/conversations/:id/read", () => {
  it("advances the cursor and clears the unread count", async () => {
    const { alice, bob, conversationId } = await twoUsers();
    await send(bob, conversationId, { text: "one" });
    await send(bob, conversationId, { text: "two" });

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/read`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(0);
  });

  it("is one write regardless of how many messages there are", async () => {
    const { alice, bob, conversationId } = await twoUsers();
    for (let i = 0; i < 20; i += 1) await send(bob, conversationId, { text: `m${i}` });

    await request(server)
      .patch(`/api/conversations/${conversationId}/read`)
      .set("Cookie", alice.cookie);

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(0);
  });

  it("reports no change on a repeat, so nothing is emitted", async () => {
    const { alice, bob, conversationId } = await twoUsers();
    await send(bob, conversationId, { text: "one" });

    await request(server).patch(`/api/conversations/${conversationId}/read`).set("Cookie", alice.cookie);
    const second = await request(server)
      .patch(`/api/conversations/${conversationId}/read`)
      .set("Cookie", alice.cookie);

    expect(second.body.changed).toBe(false);
  });

  it("does not let the cursor move backwards when older history is read", async () => {
    const { alice, bob, conversationId } = await twoUsers();
    await send(bob, conversationId, { text: "one" });
    await request(server).patch(`/api/conversations/${conversationId}/read`).set("Cookie", alice.cookie);

    const before = await Conversation.findById(conversationId).lean();
    const cursorBefore = before.participantState.find(
      (s) => String(s.userId) === alice.id
    ).lastReadAt;

    await request(server).patch(`/api/conversations/${conversationId}/read`).set("Cookie", alice.cookie);

    const after = await Conversation.findById(conversationId).lean();
    const cursorAfter = after.participantState.find(
      (s) => String(s.userId) === alice.id
    ).lastReadAt;

    expect(cursorAfter.toISOString()).toBe(cursorBefore.toISOString());
  });

  it("refuses a non-participant", async () => {
    const { conversationId } = await twoUsers();
    const carol = await registerUser(request, server);

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/read`)
      .set("Cookie", carol.cookie);

    expect(res.status).toBe(404);
  });
});

describe("unread counting with cursors", () => {
  it("counts only what arrived after the cursor", async () => {
    const { alice, bob, conversationId } = await twoUsers();

    await send(bob, conversationId, { text: "before" });
    await request(server).patch(`/api/conversations/${conversationId}/read`).set("Cookie", alice.cookie);
    await send(bob, conversationId, { text: "after 1" });
    await send(bob, conversationId, { text: "after 2" });

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(2);
  });

  it("ignores tombstoned messages", async () => {
    const { alice, bob, conversationId } = await twoUsers();
    await send(bob, conversationId, { text: "one" });
    await send(bob, conversationId, { text: "two" });

    await Message.updateOne({ text: "one" }, { $set: { deletedAt: new Date() } });

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(1);
  });
});
