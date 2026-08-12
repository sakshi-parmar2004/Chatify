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

const makeGroup = async (creator, memberIds, name = "Weekend plans") =>
  request(server)
    .post("/api/conversations/groups")
    .set("Cookie", creator.cookie)
    .send({ name, participantIds: memberIds });

const threePeople = async () => {
  const alice = await registerUser(request, server);
  const bob = await registerUser(request, server);
  const carol = await registerUser(request, server);
  const res = await makeGroup(alice, [bob.id, carol.id]);
  if (res.status !== 201) throw new Error(`createGroup failed: ${JSON.stringify(res.body)}`);
  return { alice, bob, carol, group: res.body };
};

const send = (user, conversationId, body) =>
  request(server)
    .post(`/api/conversations/${conversationId}/messages`)
    .set("Cookie", user.cookie)
    .send(body);

describe("GRP-01 — creating a group", () => {
  it("creates it with the creator as the first admin", async () => {
    const { alice, group } = await threePeople();

    expect(group.type).toBe("group");
    expect(group.name).toBe("Weekend plans");
    expect(group.participants).toHaveLength(3);
    // a group with no admin cannot be administered, and there is no way back
    expect(group.admins.map(String)).toEqual([alice.id]);
  });

  it("includes the creator even when they are not listed", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    const res = await makeGroup(alice, [bob.id]);
    expect(res.body.participants.map((p) => p._id).sort()).toEqual([alice.id, bob.id].sort());
  });

  it("dedupes a repeated participant", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    const res = await makeGroup(alice, [bob.id, bob.id, bob.id]);
    expect(res.body.participants).toHaveLength(2);
  });

  it("lets two groups share membership, unlike two direct threads", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);

    expect((await makeGroup(alice, [bob.id], "One")).status).toBe(201);
    expect((await makeGroup(alice, [bob.id], "Two")).status).toBe(201);
    expect(await Conversation.countDocuments({ type: "group" })).toBe(2);
  });

  it.each([
    ["no name", { name: "", participantIds: ["x"] }],
    ["no participants", { name: "Group", participantIds: [] }],
    ["a malformed id", { name: "Group", participantIds: ["nope"] }],
  ])("rejects %s", async (_label, body) => {
    const alice = await registerUser(request, server);
    const res = await request(server)
      .post("/api/conversations/groups")
      .set("Cookie", alice.cookie)
      .send(body);
    expect(res.status).toBe(400);
  });

  it("rejects a participant who does not exist", async () => {
    const alice = await registerUser(request, server);
    const res = await makeGroup(alice, ["507f1f77bcf86cd799439099"]);
    expect(res.status).toBe(400);
  });

  it("posts a system message rather than staying silent", async () => {
    const { group } = await threePeople();
    const messages = await Message.find({ conversationId: group._id }).lean();

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("system");
    expect(messages[0].senderId).toBeNull();
  });

  it("does not count system messages as unread", async () => {
    const { bob, group } = await threePeople();

    const list = await request(server).get("/api/conversations").set("Cookie", bob.cookie);
    const found = list.body.find((c) => c._id === group._id);
    expect(found.unreadCount).toBe(0);
  });
});

describe("GRP-02 — roles", () => {
  it("lets an admin rename the group", async () => {
    const { alice, group } = await threePeople();

    const res = await request(server)
      .patch(`/api/conversations/${group._id}/group`)
      .set("Cookie", alice.cookie)
      .send({ name: "New name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New name");
  });

  it("refuses a rename from a non-admin", async () => {
    const { bob, group } = await threePeople();

    const res = await request(server)
      .patch(`/api/conversations/${group._id}/group`)
      .set("Cookie", bob.cookie)
      .send({ name: "Hijacked" });

    // enforced server-side, not merely hidden in the UI
    expect(res.status).toBe(403);
  });

  it("promotes and demotes", async () => {
    const { alice, bob, group } = await threePeople();

    const promote = await request(server)
      .put(`/api/conversations/${group._id}/admins/${bob.id}`)
      .set("Cookie", alice.cookie);
    expect(promote.status).toBe(200);

    const demote = await request(server)
      .delete(`/api/conversations/${group._id}/admins/${bob.id}`)
      .set("Cookie", alice.cookie);
    expect(demote.status).toBe(200);

    const stored = await Conversation.findById(group._id).lean();
    expect(stored.admins.map(String)).toEqual([alice.id]);
  });

  it("refuses to demote the last admin", async () => {
    const { alice, group } = await threePeople();

    const res = await request(server)
      .delete(`/api/conversations/${group._id}/admins/${alice.id}`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(400);
  });

  it("refuses to promote someone who is not a member", async () => {
    const { alice, group } = await threePeople();
    const dave = await registerUser(request, server);

    const res = await request(server)
      .put(`/api/conversations/${group._id}/admins/${dave.id}`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(400);
  });

  it("refuses group admin routes on a direct conversation", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const { body: direct } = await request(server)
      .post(`/api/conversations/direct/${bob.id}`)
      .set("Cookie", alice.cookie);

    const res = await request(server)
      .patch(`/api/conversations/${direct._id}/group`)
      .set("Cookie", alice.cookie)
      .send({ name: "Nope" });

    expect(res.status).toBe(400);
  });
});

describe("GRP-03 — membership", () => {
  it("adds members and announces it", async () => {
    const { alice, group } = await threePeople();
    const dave = await registerUser(request, server);

    const res = await request(server)
      .post(`/api/conversations/${group._id}/participants`)
      .set("Cookie", alice.cookie)
      .send({ userIds: [dave.id] });

    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(4);

    const system = await Message.find({ conversationId: group._id, type: "system" }).lean();
    expect(system.length).toBeGreaterThan(1);
  });

  it("gives a new member a null read cursor, so history is not all unread", async () => {
    const { alice, group } = await threePeople();
    await send(alice, group._id, { text: "before dave" });

    const dave = await registerUser(request, server);
    await request(server)
      .post(`/api/conversations/${group._id}/participants`)
      .set("Cookie", alice.cookie)
      .send({ userIds: [dave.id] });

    const stored = await Conversation.findById(group._id).lean();
    const state = stored.participantState.find((s) => String(s.userId) === dave.id);
    expect(state.lastReadAt).toBeNull();
  });

  it("refuses to add someone already in the group", async () => {
    const { alice, bob, group } = await threePeople();

    const res = await request(server)
      .post(`/api/conversations/${group._id}/participants`)
      .set("Cookie", alice.cookie)
      .send({ userIds: [bob.id] });

    expect(res.status).toBe(400);
  });

  it("refuses adds from a non-admin", async () => {
    const { bob, group } = await threePeople();
    const dave = await registerUser(request, server);

    const res = await request(server)
      .post(`/api/conversations/${group._id}/participants`)
      .set("Cookie", bob.cookie)
      .send({ userIds: [dave.id] });

    expect(res.status).toBe(403);
  });

  it("lets a member leave without being an admin", async () => {
    const { bob, group } = await threePeople();

    const res = await request(server)
      .delete(`/api/conversations/${group._id}/participants/${bob.id}`)
      .set("Cookie", bob.cookie);

    expect(res.status).toBe(200);

    const stored = await Conversation.findById(group._id).lean();
    expect(stored.participants.map(String)).not.toContain(bob.id);
  });

  it("cuts a removed member off immediately", async () => {
    const { alice, bob, group } = await threePeople();

    await request(server)
      .delete(`/api/conversations/${group._id}/participants/${bob.id}`)
      .set("Cookie", alice.cookie);

    // every route, not just the list: membership is checked per request
    expect(
      (await request(server)
        .get(`/api/conversations/${group._id}/messages`)
        .set("Cookie", bob.cookie)).status
    ).toBe(404);
    expect((await send(bob, group._id, { text: "still here?" })).status).toBe(404);

    const list = await request(server).get("/api/conversations").set("Cookie", bob.cookie);
    expect(list.body.find((c) => c._id === group._id)).toBeUndefined();
  });

  it("refuses removals from a non-admin", async () => {
    const { bob, carol, group } = await threePeople();

    const res = await request(server)
      .delete(`/api/conversations/${group._id}/participants/${carol.id}`)
      .set("Cookie", bob.cookie);

    expect(res.status).toBe(403);
  });

  it("stops the last admin leaving without promoting someone", async () => {
    const { alice, bob, group } = await threePeople();

    const blocked = await request(server)
      .delete(`/api/conversations/${group._id}/participants/${alice.id}`)
      .set("Cookie", alice.cookie);
    expect(blocked.status).toBe(400);

    await request(server)
      .put(`/api/conversations/${group._id}/admins/${bob.id}`)
      .set("Cookie", alice.cookie);

    const allowed = await request(server)
      .delete(`/api/conversations/${group._id}/participants/${alice.id}`)
      .set("Cookie", alice.cookie);
    expect(allowed.status).toBe(200);
  });

  it("lets the last person standing leave", async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const { body: group } = await makeGroup(alice, [bob.id]);

    await request(server)
      .delete(`/api/conversations/${group._id}/participants/${bob.id}`)
      .set("Cookie", bob.cookie);

    const res = await request(server)
      .delete(`/api/conversations/${group._id}/participants/${alice.id}`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
  });
});

describe("GRP-05 — group read state", () => {
  it("tracks each member's cursor independently", async () => {
    const { alice, bob, group } = await threePeople();
    await send(alice, group._id, { text: "hello everyone" });

    await request(server)
      .patch(`/api/conversations/${group._id}/read`)
      .set("Cookie", bob.cookie);

    const stored = await Conversation.findById(group._id).lean();
    const bobState = stored.participantState.find((s) => String(s.userId) === bob.id);
    const carolState = stored.participantState.find(
      (s) => String(s.userId) !== bob.id && String(s.userId) !== alice.id
    );

    expect(bobState.lastReadAt).not.toBeNull();
    // one person reading is not the group reading
    expect(carolState.lastReadAt).toBeNull();
  });

  it("counts unread per member", async () => {
    const { alice, bob, carol, group } = await threePeople();
    await send(alice, group._id, { text: "one" });
    await send(alice, group._id, { text: "two" });

    await request(server).patch(`/api/conversations/${group._id}/read`).set("Cookie", bob.cookie);

    const bobList = await request(server).get("/api/conversations").set("Cookie", bob.cookie);
    const carolList = await request(server).get("/api/conversations").set("Cookie", carol.cookie);

    expect(bobList.body.find((c) => c._id === group._id).unreadCount).toBe(0);
    expect(carolList.body.find((c) => c._id === group._id).unreadCount).toBe(2);
  });
});

describe("MSG-10 — pinning", () => {
  it("pins and unpins", async () => {
    const { alice, group } = await threePeople();
    const { body: message } = await send(alice, group._id, { text: "the address" });

    const pin = await request(server)
      .put(`/api/conversations/${group._id}/pins/${message._id}`)
      .set("Cookie", alice.cookie);
    expect(pin.body.pinned).toBe(true);

    const unpin = await request(server)
      .put(`/api/conversations/${group._id}/pins/${message._id}`)
      .set("Cookie", alice.cookie);
    expect(unpin.body.pinned).toBe(false);
  });

  it("unpins a message when it is deleted", async () => {
    const { alice, group } = await threePeople();
    const { body: message } = await send(alice, group._id, { text: "the address" });

    await request(server)
      .put(`/api/conversations/${group._id}/pins/${message._id}`)
      .set("Cookie", alice.cookie);
    await request(server)
      .delete(`/api/conversations/${group._id}/messages/${message._id}`)
      .set("Cookie", alice.cookie);

    const stored = await Conversation.findById(group._id).lean();
    expect(stored.pinnedMessageIds).toHaveLength(0);
  });

  it("refuses to pin from outside the conversation", async () => {
    const { alice, group } = await threePeople();
    const dave = await registerUser(request, server);
    const { body: message } = await send(alice, group._id, { text: "hi" });

    const res = await request(server)
      .put(`/api/conversations/${group._id}/pins/${message._id}`)
      .set("Cookie", dave.cookie);

    expect(res.status).toBe(404);
  });
});

describe("MED-07 — conversation media", () => {
  const attachment = (name) => ({
    kind: "image",
    url: `https://res.cloudinary.com/test/image/upload/v1/chatify/images/${name}`,
    publicId: `chatify/images/${name}`,
    name,
    bytes: 100,
  });

  it("lists only messages that carry media, newest first", async () => {
    const { alice, group } = await threePeople();
    await send(alice, group._id, { text: "just text" });
    await send(alice, group._id, { attachment: attachment("a.png") });
    await send(alice, group._id, { attachment: attachment("b.png") });

    const res = await request(server)
      .get(`/api/conversations/${group._id}/media`)
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].attachment.name).toBe("b.png");
  });

  it("paginates", async () => {
    const { alice, group } = await threePeople();
    for (let i = 0; i < 5; i += 1) {
      await send(alice, group._id, { attachment: attachment(`${i}.png`) });
    }

    const res = await request(server)
      .get(`/api/conversations/${group._id}/media?limit=2`)
      .set("Cookie", alice.cookie);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
  });

  it("drops an item when its message is deleted", async () => {
    const { alice, group } = await threePeople();
    const { body: message } = await send(alice, group._id, { attachment: attachment("a.png") });

    await request(server)
      .delete(`/api/conversations/${group._id}/messages/${message._id}`)
      .set("Cookie", alice.cookie);

    const res = await request(server)
      .get(`/api/conversations/${group._id}/media`)
      .set("Cookie", alice.cookie);

    expect(res.body.items).toEqual([]);
  });

  it("refuses a non-participant", async () => {
    const { group } = await threePeople();
    const dave = await registerUser(request, server);

    const res = await request(server)
      .get(`/api/conversations/${group._id}/media`)
      .set("Cookie", dave.cookie);

    expect(res.status).toBe(404);
  });
});
