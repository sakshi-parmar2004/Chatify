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

// The other suites exercise the offline path, because no socket is ever
// connected to a supertest app. Stubbing the socket layer is what makes the
// online path reachable — without it, "always mark sent" is an undetectable
// regression.
const emitted = [];
const getReceiverSocketIds = vi.fn(() => []);

vi.mock("../lib/socket.js", async () => {
  const express = (await import("express")).default;
  return {
    app: express(),
    server: { listen: vi.fn(), close: vi.fn() },
    io: {
      to: (socketId) => ({
        emit: (event, payload) => emitted.push({ socketId, event, payload }),
      }),
    },
    getReceiverSocketIds: (...args) => getReceiverSocketIds(...args),
  };
});

const { app } = await import("../app.js");
const { connectTestDb, disconnectTestDb, clearCollections, registerUser, startTestServer, stopTestServer } =
  await import("./helpers.js");
const { MESSAGE_STATUS } = await import("../models/message.model.js");

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startTestServer(app);
});
afterAll(async () => {
  await stopTestServer();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearCollections();
  emitted.length = 0;
  getReceiverSocketIds.mockReset();
  getReceiverSocketIds.mockReturnValue([]);
});

const send = (from, toId, body) =>
  request(server).post(`/api/messages/send/${toId}`).set("Cookie", from.cookie).send(body);

describe("delivery status at send time", () => {
  it("marks delivered when the recipient has a socket open", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    getReceiverSocketIds.mockImplementation((id) => (id === bob.id ? ["bob-sock"] : []));

    const res = await send(alice, bob.id, { text: "hi" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(MESSAGE_STATUS.DELIVERED);
  });

  it("marks sent when the recipient has none", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    getReceiverSocketIds.mockReturnValue([]);

    const res = await send(alice, bob.id, { text: "hi" });
    expect(res.body.status).toBe(MESSAGE_STATUS.SENT);
  });

  it("pushes to every one of the recipient's sockets", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    getReceiverSocketIds.mockImplementation((id) =>
      id === bob.id ? ["bob-1", "bob-2", "bob-3"] : []
    );

    await send(alice, bob.id, { text: "hi" });

    const toBob = emitted.filter((e) => e.socketId.startsWith("bob-"));
    expect(toBob).toHaveLength(3);
    expect(toBob.every((e) => e.event === "newMessage")).toBe(true);
  });

  it("echoes the message back to the sender's own other tabs", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    getReceiverSocketIds.mockImplementation((id) => {
      if (id === bob.id) return ["bob-1"];
      if (String(id) === alice.id) return ["alice-1", "alice-2"];
      return [];
    });

    await send(alice, bob.id, { text: "hi" });

    const toAlice = emitted.filter((e) => e.socketId.startsWith("alice-"));
    expect(toAlice).toHaveLength(2);
    expect(toAlice[0].event).toBe("newMessage");
  });
});

describe("read receipts over the socket", () => {
  it("notifies the sender and the reader's own other tabs", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    await send(bob, alice.id, { text: "hi" });
    emitted.length = 0;

    getReceiverSocketIds.mockImplementation((id) => {
      if (String(id) === bob.id) return ["bob-1"];
      if (String(id) === alice.id) return ["alice-1"];
      return [];
    });

    await request(server).patch(`/api/messages/read/${bob.id}`).set("Cookie", alice.cookie);

    // the sender learns their message was read
    const toSender = emitted.find((e) => e.event === "messagesRead");
    expect(toSender.socketId).toBe("bob-1");
    expect(toSender.payload.partnerId).toBe(alice.id);
    expect(toSender.payload.readAt).toBeTruthy();

    // the reader's other tabs clear their badge
    const toSelf = emitted.find((e) => e.event === "conversationRead");
    expect(toSelf.socketId).toBe("alice-1");
    expect(toSelf.payload.partnerId).toBe(bob.id);
  });

  it("emits nothing when the conversation was already read", async () => {
    const [alice, bob] = [await registerUser(request, server), await registerUser(request, server)];
    await send(bob, alice.id, { text: "hi" });
    await request(server).patch(`/api/messages/read/${bob.id}`).set("Cookie", alice.cookie);

    emitted.length = 0;
    getReceiverSocketIds.mockImplementation(() => ["some-sock"]);

    await request(server).patch(`/api/messages/read/${bob.id}`).set("Cookie", alice.cookie);
    expect(emitted).toEqual([]);
  });
});
