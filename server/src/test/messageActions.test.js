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
const { EDIT_WINDOW_MS } = await import("../controller/message.actions.controller.js");

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startTestServer(app);
  await Conversation.syncIndexes();
  await Message.syncIndexes(); // the text index MSG-07 needs
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

describe("MSG-04 — editing", () => {
  it("edits your own message and marks it edited", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "teh typo" });

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", alice.cookie)
      .send({ text: "the typo" });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe("the typo");
    expect(res.body.editedAt).toBeTruthy();
  });

  it("refuses to edit someone else's message", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "mine" });

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", bob.cookie)
      .send({ text: "hijacked" });

    expect(res.status).toBe(403);
    expect((await Message.findById(message._id)).text).toBe("mine");
  });

  it("refuses an empty edit", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", alice.cookie)
      .send({ text: "   " });

    expect(res.status).toBe(400);
  });

  it("refuses to edit outside the window", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "old" });

    // Through the driver, because Mongoose marks createdAt immutable and drops
    // a model-level $set on it. The id has to be cast by hand — the raw driver
    // does not do it, and a string filter silently matches nothing.
    await Message.collection.updateOne(
      { _id: new Message.base.Types.ObjectId(message._id) },
      { $set: { createdAt: new Date(Date.now() - EDIT_WINDOW_MS - 60_000) } }
    );

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", alice.cookie)
      .send({ text: "too late" });

    expect(res.status).toBe(400);
  });

  it("updates the snapshot every reply is quoting", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: parent } = await send(alice, conversationId, { text: "original" });
    await send(bob, conversationId, { text: "agreed", replyTo: parent._id });

    await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${parent._id}`)
      .set("Cookie", alice.cookie)
      .send({ text: "corrected" });

    const reply = await Message.findOne({ replyTo: parent._id });
    expect(reply.replySnapshot.text).toBe("corrected");
  });

  it("refuses to edit from outside the conversation", async () => {
    const { alice, conversationId } = await setup();
    const carol = await registerUser(request, server);
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const res = await request(server)
      .patch(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", carol.cookie)
      .send({ text: "nope" });

    expect(res.status).toBe(404);
  });
});

describe("MSG-04 — deleting", () => {
  it("tombstones rather than removing, and clears the content", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "secret" });

    const res = await request(server)
      .delete(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);

    const stored = await Message.findById(message._id);
    expect(stored).not.toBeNull(); // the row survives so cursors do not get holes
    expect(stored.deletedAt).toBeTruthy();
    expect(stored.text).toBe("");
  });

  it("refuses to delete someone else's message", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "mine" });

    const res = await request(server)
      .delete(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", bob.cookie);

    expect(res.status).toBe(403);
  });

  it("leaves a reply readable, marked as quoting a deleted message", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: parent } = await send(alice, conversationId, { text: "original" });
    const { body: reply } = await send(bob, conversationId, {
      text: "still here",
      replyTo: parent._id,
    });

    await request(server)
      .delete(`/api/conversations/${conversationId}/messages/${parent._id}`)
      .set("Cookie", alice.cookie);

    const stored = await Message.findById(reply._id);
    expect(stored.text).toBe("still here");
    expect(stored.replySnapshot.deleted).toBe(true);
  });

  it("is idempotent", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const url = `/api/conversations/${conversationId}/messages/${message._id}`;
    await request(server).delete(url).set("Cookie", alice.cookie);
    const second = await request(server).delete(url).set("Cookie", alice.cookie);

    expect(second.status).toBe(200);
  });

  it("stops counting toward unread", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: one } = await send(bob, conversationId, { text: "one" });
    await send(bob, conversationId, { text: "two" });

    await request(server)
      .delete(`/api/conversations/${conversationId}/messages/${one._id}`)
      .set("Cookie", bob.cookie);

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].unreadCount).toBe(1);
  });
});

describe("MSG-05 — reply and quote", () => {
  it("stores a snapshot of the quoted message", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: parent } = await send(alice, conversationId, { text: "what time?" });

    const res = await send(bob, conversationId, { text: "seven", replyTo: parent._id });

    expect(res.status).toBe(201);
    expect(res.body.replyTo).toBe(parent._id);
    expect(res.body.replySnapshot.text).toBe("what time?");
  });

  it("refuses a reply to a message in another conversation", async () => {
    const { alice, conversationId } = await setup();
    const carol = await registerUser(request, server);
    const { body: other } = await request(server)
      .post(`/api/conversations/direct/${carol.id}`)
      .set("Cookie", alice.cookie);
    const { body: elsewhere } = await send(alice, other._id, { text: "private" });

    // quoting across conversations would leak the quoted text
    const res = await send(alice, conversationId, { text: "leak?", replyTo: elsewhere._id });
    expect(res.status).toBe(400);
  });

  it("refuses a malformed reply target", async () => {
    const { alice, conversationId } = await setup();
    const res = await send(alice, conversationId, { text: "hi", replyTo: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("MSG-06 — reactions", () => {
  const react = (user, conversationId, messageId, emoji) =>
    request(server)
      .put(`/api/conversations/${conversationId}/messages/${messageId}/reactions`)
      .set("Cookie", user.cookie)
      .send({ emoji });

  it("adds a reaction", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const res = await react(bob, conversationId, message._id, "👍");

    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(1);
    expect(res.body.reactions[0].emoji).toBe("👍");
  });

  it("toggles off on a repeat rather than double-counting", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    await react(bob, conversationId, message._id, "👍");
    const res = await react(bob, conversationId, message._id, "👍");

    expect(res.body.reactions).toHaveLength(0);
  });

  it("lets different people react with the same emoji", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    await react(alice, conversationId, message._id, "🎉");
    const res = await react(bob, conversationId, message._id, "🎉");

    expect(res.body.reactions).toHaveLength(2);
  });

  it("lets one person use several emoji", async () => {
    const { alice, bob, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    await react(bob, conversationId, message._id, "👍");
    const res = await react(bob, conversationId, message._id, "🎉");

    expect(res.body.reactions).toHaveLength(2);
  });

  it("rejects an oversized payload dressed as an emoji", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const res = await react(alice, conversationId, message._id, "x".repeat(500));
    expect(res.status).toBe(400);
  });

  it("refuses reactions from outside the conversation", async () => {
    const { alice, conversationId } = await setup();
    const carol = await registerUser(request, server);
    const { body: message } = await send(alice, conversationId, { text: "hi" });

    const res = await react(carol, conversationId, message._id, "👍");
    expect(res.status).toBe(404);
  });
});

describe("MSG-07 — search", () => {
  it("finds a message by text", async () => {
    const { alice, conversationId } = await setup();
    await send(alice, conversationId, { text: "the quick brown fox" });
    await send(alice, conversationId, { text: "something unrelated" });

    const res = await request(server)
      .get("/api/conversations/search?q=brown")
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].text).toContain("brown");
  });

  it("never returns a conversation the caller is not in", async () => {
    const { alice, conversationId } = await setup();
    await send(alice, conversationId, { text: "shared secret" });

    const carol = await registerUser(request, server);
    const res = await request(server)
      .get("/api/conversations/search?q=secret")
      .set("Cookie", carol.cookie);

    expect(res.body.results).toEqual([]);
  });

  it("narrows to one conversation but cannot widen past your own", async () => {
    const { alice, bob, conversationId } = await setup();
    await send(alice, conversationId, { text: "findme here" });

    const carol = await registerUser(request, server);
    const { body: other } = await request(server)
      .post(`/api/conversations/direct/${carol.id}`)
      .set("Cookie", bob.cookie);
    await send(bob, other._id, { text: "findme elsewhere" });

    // alice asking for bob-and-carol's conversation gets nothing, not an error
    const res = await request(server)
      .get(`/api/conversations/search?q=findme&conversationId=${other._id}`)
      .set("Cookie", alice.cookie);

    expect(res.body.results).toEqual([]);
  });

  it("excludes deleted messages", async () => {
    const { alice, conversationId } = await setup();
    const { body: message } = await send(alice, conversationId, { text: "ephemeral content" });

    await request(server)
      .delete(`/api/conversations/${conversationId}/messages/${message._id}`)
      .set("Cookie", alice.cookie);

    const res = await request(server)
      .get("/api/conversations/search?q=ephemeral")
      .set("Cookie", alice.cookie);

    expect(res.body.results).toEqual([]);
  });

  it("rejects a one-character search", async () => {
    const { alice } = await setup();
    const res = await request(server).get("/api/conversations/search?q=a").set("Cookie", alice.cookie);
    expect(res.status).toBe(400);
  });

  it("is not swallowed by the /:id route", async () => {
    const { alice } = await setup();
    const res = await request(server)
      .get("/api/conversations/search?q=anything")
      .set("Cookie", alice.cookie);
    // a 400/200 proves it reached the search handler, not loadConversation's 400
    expect(res.body).toHaveProperty("results");
  });
});
