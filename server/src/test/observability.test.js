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
  connectTestDb, disconnectTestDb, clearCollections, registerUser,
  startTestServer, stopTestServer,
} = await import("./helpers.js");
const AuditEvent = (await import("../models/auditEvent.model.js")).default;
const ClientError = (await import("../models/clientError.model.js")).default;
const User = (await import("../models/user.model.js")).default;
const { recordEvent } = await import("../lib/audit.js");

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startTestServer(app);
});
afterAll(async () => {
  await stopTestServer();
  await disconnectTestDb();
});
beforeEach(clearCollections);

/** recordEvent is fire-and-forget by design, so tests wait for the write. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

const makeAdmin = async (user) => {
  await User.updateOne({ _id: user.id }, { $set: { role: "admin" } });
  // the role is read from the session's user document on each request
  return user;
};

describe("OBS-02 — audit events", () => {
  it("records a registration and a login", async () => {
    const alice = await registerUser(request, server);
    await request(server)
      .post("/api/auth/login")
      .send({ email: alice.email, password: alice.password });
    await settle();

    const actions = (await AuditEvent.find({ actorId: alice.id }).lean()).map((e) => e.action);
    expect(actions).toContain("user.register");
    expect(actions).toContain("user.login");
  });

  it("records a group creation with its member count, not its messages", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    await request(server)
      .post("/api/conversations/groups")
      .set("Cookie", alice.cookie)
      .send({ name: "Trip", participantIds: [bob.id] });
    await settle();

    const event = await AuditEvent.findOne({ action: "group.created" }).lean();
    expect(event.metadata.members).toBe(2);
    expect(String(event.actorId)).toBe(alice.id);
  });

  it("records that a message was deleted but never what it said", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const { body: conversation } = await request(server)
      .post(`/api/conversations/direct/${bob.id}`)
      .set("Cookie", alice.cookie);
    const { body: message } = await request(server)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set("Cookie", alice.cookie)
      .send({ text: "a secret worth not logging" });

    await request(server)
      .delete(`/api/conversations/${conversation._id}/messages/${message._id}`)
      .set("Cookie", alice.cookie);
    await settle();

    const event = await AuditEvent.findOne({ action: "message.deleted" }).lean();
    expect(event).toBeTruthy();
    // the schema has no field for it, so this holds by construction
    expect(JSON.stringify(event)).not.toContain("a secret worth not logging");
  });

  it("bounds metadata so a controller cannot smuggle a document into it", async () => {
    const alice = await registerUser(request, server);

    recordEvent({
      actorId: alice.id,
      action: "user.login",
      metadata: { long: "x".repeat(5000), nested: { text: "hello" } },
    });
    await settle();

    const event = await AuditEvent.findOne({ actorId: alice.id, action: "user.login" }).lean();
    expect(event.metadata.long.length).toBeLessThanOrEqual(200);
  });

  it("rejects an action outside the taxonomy", async () => {
    const alice = await registerUser(request, server);
    recordEvent({ actorId: alice.id, action: "totally.made.up" });
    await settle();

    expect(await AuditEvent.countDocuments({ action: "totally.made.up" })).toBe(0);
  });

  it("has a TTL so it does not grow without bound", async () => {
    await AuditEvent.syncIndexes();
    const indexes = await AuditEvent.collection.indexes();
    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);

    expect(ttl).toBeTruthy();
    expect(ttl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
  });

  it("shows a user their own activity and nobody else's", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    await settle();

    const res = await request(server)
      .get("/api/preferences/activity")
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events.every((e) => String(e.actorId) === alice.id)).toBe(true);
    expect(res.body.events.some((e) => String(e.actorId) === bob.id)).toBe(false);
  });
});

describe("OBS-03 — client error reporting", () => {
  const report = (user, body) =>
    request(server).post("/api/logs/client").set("Cookie", user.cookie).send(body);

  it("records a render crash", async () => {
    const alice = await registerUser(request, server);

    const res = await report(alice, {
      message: "Cannot access 'x' before initialization",
      stack: "  at MessageInput (MessageInput.jsx:16)\n  at renderWithHooks",
      kind: "render",
      path: "/",
    });

    expect(res.status).toBe(201);
    const stored = await ClientError.findOne({}).lean();
    expect(stored.message).toContain("before initialization");
    expect(stored.count).toBe(1);
  });

  it("deduplicates repeats onto one row with a count", async () => {
    const alice = await registerUser(request, server);
    const payload = { message: "Boom", stack: "  at Thing (a.jsx:1)" };

    // a render loop would otherwise write a row per frame
    await report(alice, payload);
    await report(alice, payload);
    await report(alice, payload);

    expect(await ClientError.countDocuments({})).toBe(1);
    expect((await ClientError.findOne({}).lean()).count).toBe(3);
  });

  it("counts distinct errors separately", async () => {
    const alice = await registerUser(request, server);
    await report(alice, { message: "One", stack: "  at A (a.jsx:1)" });
    await report(alice, { message: "Two", stack: "  at B (b.jsx:1)" });

    expect(await ClientError.countDocuments({})).toBe(2);
  });

  it("strips the query string and hash, which carry ids", async () => {
    const alice = await registerUser(request, server);
    await report(alice, {
      message: "Boom",
      path: "/?conversation=507f1f77bcf86cd799439011#token=abc",
    });

    const stored = await ClientError.findOne({}).lean();
    expect(stored.path).toBe("/");
  });

  it("keeps only stack-frame lines, so a thrown message body cannot ride along", async () => {
    const alice = await registerUser(request, server);
    await report(alice, {
      message: "Boom",
      stack: "Error: the user typed something private\n  at Thing (a.jsx:1)",
    });

    const stored = await ClientError.findOne({}).lean();
    expect(stored.stack).not.toContain("something private");
    expect(stored.stack).toContain("at Thing");
  });

  it("truncates an oversized message rather than storing it", async () => {
    const alice = await registerUser(request, server);
    await report(alice, { message: "x".repeat(5000) });

    expect((await ClientError.findOne({}).lean()).message.length).toBeLessThanOrEqual(500);
  });

  it("caps how much one broken tab can write", async () => {
    const alice = await registerUser(request, server);

    const results = [];
    for (let i = 0; i < 30; i += 1) {
      results.push((await report(alice, { message: `Boom ${i}`, stack: `  at A${i} (a.jsx:1)` })).status);
    }

    // 202 rather than 429 — the client must not retry, and a failed error
    // report is never worth surfacing to the user
    expect(results).toContain(202);
    expect(await ClientError.countDocuments({})).toBeLessThanOrEqual(20);
  });

  it("requires a message and authentication", async () => {
    const alice = await registerUser(request, server);

    expect((await report(alice, {})).status).toBe(400);
    expect((await request(server).post("/api/logs/client").send({ message: "x" })).status).toBe(401);
  });
});

describe("OBS-04 — admin surface", () => {
  it.each(["/api/admin/overview", "/api/admin/audit", "/api/admin/errors"])(
    "hides %s from a non-admin",
    async (route) => {
      const alice = await registerUser(request, server);
      const res = await request(server).get(route).set("Cookie", alice.cookie);

      // 404 rather than 403: a 403 confirms the route exists and that admins do
      expect(res.status).toBe(404);
    }
  );

  it.each(["/api/admin/overview", "/api/admin/audit", "/api/admin/errors"])(
    "requires authentication for %s",
    async (route) => {
      expect((await request(server).get(route)).status).toBe(401);
    }
  );

  it("lets an admin read audit events", async () => {
    const admin = await makeAdmin(await registerUser(request, server));
    await settle();

    const res = await request(server).get("/api/admin/audit").set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events[0].actor).toHaveProperty("name");
  });

  it("never exposes message content to an admin", async () => {
    const admin = await makeAdmin(await registerUser(request, server));
    const bob = await registerUser(request, server);

    const { body: conversation } = await request(server)
      .post(`/api/conversations/direct/${bob.id}`)
      .set("Cookie", bob.cookie);
    await request(server)
      .post(`/api/conversations/${conversation._id}/messages`)
      .set("Cookie", bob.cookie)
      .send({ text: "nuclear launch codes" });
    await settle();

    const audit = await request(server).get("/api/admin/audit").set("Cookie", admin.cookie);
    const errors = await request(server).get("/api/admin/errors").set("Cookie", admin.cookie);

    expect(JSON.stringify(audit.body)).not.toContain("nuclear launch codes");
    expect(JSON.stringify(errors.body)).not.toContain("nuclear launch codes");
  });

  it("filters by action and rejects an unknown one", async () => {
    const admin = await makeAdmin(await registerUser(request, server));
    await settle();

    const ok = await request(server)
      .get("/api/admin/audit?action=user.register")
      .set("Cookie", admin.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.events.every((e) => e.action === "user.register")).toBe(true);

    const bad = await request(server)
      .get("/api/admin/audit?action=drop.everything")
      .set("Cookie", admin.cookie);
    expect(bad.status).toBe(400);
  });

  it("paginates", async () => {
    const admin = await makeAdmin(await registerUser(request, server));
    for (let i = 0; i < 5; i += 1) {
      recordEvent({ actorId: admin.id, action: "user.login" });
    }
    await settle();

    const res = await request(server)
      .get("/api/admin/audit?limit=2")
      .set("Cookie", admin.cookie);

    expect(res.body.events).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it("reports counts without reporting message volume", async () => {
    const admin = await makeAdmin(await registerUser(request, server));

    const res = await request(server).get("/api/admin/overview").set("Cookie", admin.cookie);

    expect(res.body).toHaveProperty("users");
    expect(res.body.retention.auditDays).toBe(90);
    // an operator has no reason to know how much anyone is talking
    expect(res.body).not.toHaveProperty("messages");
    expect(res.body).not.toHaveProperty("conversations");
  });
});
