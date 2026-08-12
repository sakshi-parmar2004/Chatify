import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("../middleware/arcjet.middleware.js", () => ({
  arcjetProtection: (_req, _res, next) => next(),
  strictArcjetProtection: (_req, _res, next) => next(),
}));
vi.mock("../lib/email.js", () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/cloudinary.js", () => ({
  default: {
    uploader: { upload: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/i.jpg" }) },
  },
}));

const { app } = await import("../app.js");
const { connectTestDb, disconnectTestDb, clearCollections, registerUser } =
  await import("./helpers.js");
const Message = (await import("../models/message.model.js")).default;
const { MESSAGE_STATUS } = await import("../models/message.model.js");

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearCollections);

const send = (from, toId, body) =>
  request(app).post(`/api/messages/send/${toId}`).set("Cookie", from.cookie).send(body);

describe("POST /api/messages/send/:id", () => {
  it("sends a text message", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    const res = await send(alice, bob.id, { text: "hello" });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe("hello");
    expect(res.body.senderId).toBe(alice.id);
    expect(res.body.receiverId).toBe(bob.id);
  });

  it("marks a message sent when the recipient has no socket open", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    // no socket is connected anywhere in these tests, so this is the offline path
    const res = await send(alice, bob.id, { text: "hello" });
    expect(res.body.status).toBe(MESSAGE_STATUS.SENT);
  });

  it.each([
    ["an empty body", {}, 400],
    ["a non-existent recipient", { text: "hi" }, 404],
    ["a malformed recipient id", { text: "hi" }, 400],
  ])("rejects %s", async (label, body, expected) => {
    const alice = await registerUser(request, app);
    const target =
      label === "a malformed recipient id"
        ? "not-an-object-id"
        : label === "a non-existent recipient"
          ? "507f1f77bcf86cd799439099"
          : (await registerUser(request, app)).id;

    const res = await send(alice, target, body);
    expect(res.status).toBe(expected);
  });

  it("refuses a message to yourself", async () => {
    const alice = await registerUser(request, app);
    const res = await send(alice, alice.id, { text: "hi" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const bob = await registerUser(request, app);
    const res = await request(app).post(`/api/messages/send/${bob.id}`).send({ text: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects an image that is not a data URI, before Cloudinary is called", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];
    const res = await send(alice, bob.id, { image: "https://evil.test/internal" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/messages/:id", () => {
  it("returns the conversation in chronological order, both directions", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    await send(alice, bob.id, { text: "one" });
    await send(bob, alice.id, { text: "two" });
    await send(alice, bob.id, { text: "three" });

    const res = await request(app).get(`/api/messages/${bob.id}`).set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.map((m) => m.text)).toEqual(["one", "two", "three"]);
  });

  it("does not leak a conversation between two other people", async () => {
    const [alice, bob, carol] = [
      await registerUser(request, app),
      await registerUser(request, app),
      await registerUser(request, app),
    ];

    await send(bob, carol.id, { text: "private" });

    const res = await request(app).get(`/api/messages/${bob.id}`).set("Cookie", alice.cookie);
    expect(res.body).toEqual([]);
  });

  it("rejects a malformed id rather than surfacing a cast error as a 500", async () => {
    const alice = await registerUser(request, app);
    const res = await request(app).get("/api/messages/not-an-id").set("Cookie", alice.cookie);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/messages/chats", () => {
  it("returns partners newest-first with unread counts and a last-message preview", async () => {
    const [alice, bob, carol] = [
      await registerUser(request, app),
      await registerUser(request, app),
      await registerUser(request, app),
    ];

    await send(bob, alice.id, { text: "from bob 1" });
    await send(bob, alice.id, { text: "from bob 2" });
    await send(carol, alice.id, { text: "from carol" });

    const res = await request(app).get("/api/messages/chats").set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.name)).toEqual([carol.name, bob.name]);
    expect(res.body[0].unreadCount).toBe(1);
    expect(res.body[1].unreadCount).toBe(2);
    expect(res.body[1].lastMessage.text).toBe("from bob 2");
    expect(res.body[0].password).toBeUndefined();
  });

  it("does not count your own outgoing messages as unread", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    await send(alice, bob.id, { text: "mine" });

    const res = await request(app).get("/api/messages/chats").set("Cookie", alice.cookie);
    expect(res.body[0].unreadCount).toBe(0);
  });

  it("excludes messages written before the status field existed", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    // insert straight through the driver so no schema default is applied
    await Message.collection.insertOne({
      senderId: new Message.base.Types.ObjectId(bob.id),
      receiverId: new Message.base.Types.ObjectId(alice.id),
      text: "legacy",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).get("/api/messages/chats").set("Cookie", alice.cookie);
    expect(res.body[0].unreadCount).toBe(0);
  });
});

describe("PATCH /api/messages/read/:id", () => {
  it("marks the conversation read and reports how many changed", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];

    await send(bob, alice.id, { text: "one" });
    await send(bob, alice.id, { text: "two" });

    const res = await request(app)
      .patch(`/api/messages/read/${bob.id}`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.modifiedCount).toBe(2);
    expect(await Message.countDocuments({ status: MESSAGE_STATUS.READ })).toBe(2);
  });

  it("is idempotent, so a repeat open costs nothing and emits nothing", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];
    await send(bob, alice.id, { text: "one" });

    await request(app).patch(`/api/messages/read/${bob.id}`).set("Cookie", alice.cookie);
    const second = await request(app)
      .patch(`/api/messages/read/${bob.id}`)
      .set("Cookie", alice.cookie);

    expect(second.body.modifiedCount).toBe(0);
  });

  it("cannot mark messages addressed to someone else", async () => {
    const [alice, bob, carol] = [
      await registerUser(request, app),
      await registerUser(request, app),
      await registerUser(request, app),
    ];

    await send(bob, carol.id, { text: "not for alice" });

    const res = await request(app)
      .patch(`/api/messages/read/${bob.id}`)
      .set("Cookie", alice.cookie);

    expect(res.body.modifiedCount).toBe(0);
    expect(await Message.countDocuments({ status: MESSAGE_STATUS.READ })).toBe(0);
  });

  it("does not mark your own outgoing messages read", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];
    await send(alice, bob.id, { text: "mine" });

    const res = await request(app)
      .patch(`/api/messages/read/${bob.id}`)
      .set("Cookie", alice.cookie);

    expect(res.body.modifiedCount).toBe(0);
  });

  it("clears the unread count the chat list reports", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];
    await send(bob, alice.id, { text: "one" });

    await request(app).patch(`/api/messages/read/${bob.id}`).set("Cookie", alice.cookie);

    const chats = await request(app).get("/api/messages/chats").set("Cookie", alice.cookie);
    expect(chats.body[0].unreadCount).toBe(0);
  });

  it("rejects a malformed id and requires authentication", async () => {
    const alice = await registerUser(request, app);

    const malformed = await request(app)
      .patch("/api/messages/read/not-an-id")
      .set("Cookie", alice.cookie);
    expect(malformed.status).toBe(400);

    const anonymous = await request(app).patch(`/api/messages/read/${alice.id}`);
    expect(anonymous.status).toBe(401);
  });

  it("is routed ahead of the GET /:id catch-all", async () => {
    const [alice, bob] = [await registerUser(request, app), await registerUser(request, app)];
    await send(bob, alice.id, { text: "one" });

    // "read" must not be swallowed as a user id by GET /:id
    const res = await request(app)
      .patch(`/api/messages/read/${bob.id}`)
      .set("Cookie", alice.cookie);
    expect(res.body).toHaveProperty("modifiedCount");
  });
});

describe("GET /api/messages/contacts", () => {
  it("returns every user except yourself, without passwords", async () => {
    const [alice] = [
      await registerUser(request, app),
      await registerUser(request, app),
      await registerUser(request, app),
    ];

    const res = await request(app).get("/api/messages/contacts").set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.some((u) => u._id === alice.id)).toBe(false);
    expect(res.body.every((u) => u.password === undefined)).toBe(true);
  });
});
