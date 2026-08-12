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
const Conversation = (await import("../models/conversation.model.js")).default;
const { THEME_IDS, validateWallpaper } = await import("../lib/appearance.js");

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

const CLOUD = "https://res.cloudinary.com/test/image/upload/v1/chatify/images/w.png";

describe("UIX-03 — theme preference", () => {
  it("defaults to midnight", async () => {
    const alice = await registerUser(request, server);
    const res = await request(server).get("/api/preferences").set("Cookie", alice.cookie);

    expect(res.status).toBe(200);
    expect(res.body.preferences.theme).toBe("midnight");
    expect(res.body.preferences.reduceTransparency).toBe(false);
  });

  it.each(THEME_IDS)("accepts and echoes the %s theme", async (theme) => {
    const alice = await registerUser(request, server);
    const res = await request(server)
      .put("/api/preferences")
      .set("Cookie", alice.cookie)
      .send({ theme });

    expect(res.status).toBe(200);
    expect(res.body.preferences.theme).toBe(theme);
  });

  it("refuses an unknown theme rather than storing it", async () => {
    const alice = await registerUser(request, server);

    // storing it would look like the setting silently not working: the client
    // falls back on every render and nothing says why
    const res = await request(server)
      .put("/api/preferences")
      .set("Cookie", alice.cookie)
      .send({ theme: "vaporwave" });

    expect(res.status).toBe(400);

    const after = await request(server).get("/api/preferences").set("Cookie", alice.cookie);
    expect(after.body.preferences.theme).toBe("midnight");
  });

  it("updates one field without clearing the others", async () => {
    const alice = await registerUser(request, server);

    await request(server).put("/api/preferences").set("Cookie", alice.cookie).send({ theme: "ember" });
    await request(server)
      .put("/api/preferences")
      .set("Cookie", alice.cookie)
      .send({ reduceTransparency: true });

    const res = await request(server).get("/api/preferences").set("Cookie", alice.cookie);
    expect(res.body.preferences).toMatchObject({ theme: "ember", reduceTransparency: true });
  });

  it("rejects an empty update and a non-boolean toggle", async () => {
    const alice = await registerUser(request, server);

    expect(
      (await request(server).put("/api/preferences").set("Cookie", alice.cookie).send({})).status
    ).toBe(400);
    expect(
      (await request(server)
        .put("/api/preferences")
        .set("Cookie", alice.cookie)
        .send({ reduceTransparency: "yes" })).status
    ).toBe(400);
  });

  it("reaches the client through authUser, not a second request", async () => {
    const alice = await registerUser(request, server);
    await request(server).put("/api/preferences").set("Cookie", alice.cookie).send({ theme: "aurora" });

    const me = await request(server).get("/api/auth/get-user").set("Cookie", alice.cookie);
    expect(me.body.user.preferences.theme).toBe("aurora");
  });

  it("requires authentication", async () => {
    expect((await request(server).get("/api/preferences")).status).toBe(401);
  });
});

describe("UIX-04 — wallpaper validation", () => {
  it.each([
    ["null clears it", null, { preset: null, url: null }],
    ["a known preset", { preset: "mesh" }, { preset: "mesh", url: null }],
    ["an uploaded image", { url: CLOUD }, { preset: null, url: CLOUD }],
  ])("accepts %s", (_label, input, expected) => {
    expect(validateWallpaper(input)).toEqual({ ok: true, value: expected });
  });

  it("rejects an unknown preset", () => {
    expect(validateWallpaper({ preset: "nope" }).ok).toBe(false);
  });

  it("rejects a URL that is not on our asset host", () => {
    // otherwise a "wallpaper" is an arbitrary URL the app renders for you
    expect(validateWallpaper({ url: "https://evil.test/tracker.png" }).ok).toBe(false);
  });

  it("lets an uploaded image win over a preset rather than keeping both", () => {
    expect(validateWallpaper({ preset: "mesh", url: CLOUD }).value).toEqual({
      preset: null,
      url: CLOUD,
    });
  });
});

describe("UIX-04 — per-conversation wallpaper", () => {
  const setup = async () => {
    const alice = await registerUser(request, server);
    const bob = await registerUser(request, server);
    const { body: conversation } = await request(server)
      .post(`/api/conversations/direct/${bob.id}`)
      .set("Cookie", alice.cookie);
    return { alice, bob, conversationId: conversation._id };
  };

  it("stores and returns it for the person who set it", async () => {
    const { alice, conversationId } = await setup();

    const res = await request(server)
      .put(`/api/conversations/${conversationId}/wallpaper`)
      .set("Cookie", alice.cookie)
      .send({ wallpaper: { preset: "dusk" } });

    expect(res.status).toBe(200);

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].wallpaper).toEqual({ preset: "dusk", url: null });
  });

  it("is invisible to the other participant", async () => {
    const { alice, bob, conversationId } = await setup();

    await request(server)
      .put(`/api/conversations/${conversationId}/wallpaper`)
      .set("Cookie", alice.cookie)
      .send({ wallpaper: { preset: "dusk" } });

    // the same thread may look different to each participant — that is the
    // whole reason this lives in participantState
    const list = await request(server).get("/api/conversations").set("Cookie", bob.cookie);
    expect(list.body[0].wallpaper).toEqual({ preset: null, url: null });
  });

  it("clears with null", async () => {
    const { alice, conversationId } = await setup();

    await request(server)
      .put(`/api/conversations/${conversationId}/wallpaper`)
      .set("Cookie", alice.cookie)
      .send({ wallpaper: { preset: "dusk" } });
    await request(server)
      .put(`/api/conversations/${conversationId}/wallpaper`)
      .set("Cookie", alice.cookie)
      .send({ wallpaper: null });

    const list = await request(server).get("/api/conversations").set("Cookie", alice.cookie);
    expect(list.body[0].wallpaper).toEqual({ preset: null, url: null });
  });

  it("refuses a non-participant", async () => {
    const { conversationId } = await setup();
    const carol = await registerUser(request, server);

    const res = await request(server)
      .put(`/api/conversations/${conversationId}/wallpaper`)
      .set("Cookie", carol.cookie)
      .send({ wallpaper: { preset: "dusk" } });

    expect(res.status).toBe(404);
  });
});
