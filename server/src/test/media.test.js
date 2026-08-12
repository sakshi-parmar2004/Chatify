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
    utils: { api_sign_request: vi.fn(() => "signed") },
  },
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
const { MAX_BYTES } = await import("../controller/upload.controller.js");
const { isBlockedAddress, firstUrlIn, resolveLinkPreview } =
  await import("../lib/linkPreview.js");

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

describe("MED-01 — upload signatures", () => {
  const sign = (user, body) =>
    request(server).post("/api/conversations/uploads/sign").set("Cookie", user.cookie).send(body);

  it("issues a signature scoped to a server-chosen folder", async () => {
    const { alice } = await setup();

    const res = await sign(alice, { kind: "image", bytes: 1024 });

    expect(res.status).toBe(200);
    expect(res.body.signature).toBe("signed");
    // the folder is the server's decision, never the client's
    expect(res.body.folder).toBe("chatify/images");
    expect(res.body.timestamp).toBeTruthy();
  });

  it.each([
    ["image", "chatify/images", "image"],
    ["video", "chatify/videos", "video"],
    ["audio", "chatify/voice", "video"],
    ["file", "chatify/files", "raw"],
  ])("maps %s to its own folder and resource type", async (kind, folder, resourceType) => {
    const { alice } = await setup();
    const res = await sign(alice, { kind, bytes: 1024 });

    expect(res.body.folder).toBe(folder);
    // audio rides the video pipeline, which is where duration support lives
    expect(res.body.resourceType).toBe(resourceType);
  });

  it("never signs a client-supplied folder or public id", async () => {
    const { alice } = await setup();

    const res = await sign(alice, {
      kind: "image",
      bytes: 1024,
      folder: "../../someone-elses",
      public_id: "overwrite-me",
    });

    expect(res.body.folder).toBe("chatify/images");
    expect(res.body.public_id).toBeUndefined();
  });

  it("refuses an unknown kind and a missing size", async () => {
    const { alice } = await setup();

    expect((await sign(alice, { kind: "executable", bytes: 10 })).status).toBe(400);
    expect((await sign(alice, { kind: "image" })).status).toBe(400);
    expect((await sign(alice, { kind: "image", bytes: -1 })).status).toBe(400);
  });

  it("refuses a file over the limit before it is uploaded", async () => {
    const { alice } = await setup();

    const res = await sign(alice, { kind: "image", bytes: MAX_BYTES.image + 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });

  it("requires authentication", async () => {
    const res = await request(server)
      .post("/api/conversations/uploads/sign")
      .send({ kind: "image", bytes: 10 });
    expect(res.status).toBe(401);
  });
});

describe("MED-03..05 — attachments on a message", () => {
  const attachment = (over = {}) => ({
    kind: "file",
    url: "https://res.cloudinary.com/test/raw/upload/v1/chatify/files/report.pdf",
    publicId: "chatify/files/report",
    name: "report.pdf",
    bytes: 2048,
    ...over,
  });

  const send = (user, conversationId, body) =>
    request(server)
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", user.cookie)
      .send(body);

  it("accepts a message that is only an attachment", async () => {
    const { alice, conversationId } = await setup();

    const res = await send(alice, conversationId, { attachment: attachment() });

    expect(res.status).toBe(201);
    expect(res.body.attachment.name).toBe("report.pdf");
  });

  it("rejects an attachment pointing anywhere but our asset host", async () => {
    const { alice, conversationId } = await setup();

    // otherwise an "attachment" is just an arbitrary link with a filename
    const res = await send(alice, conversationId, {
      attachment: attachment({ url: "https://evil.test/malware.exe" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown attachment kind and a malformed shape", async () => {
    const { alice, conversationId } = await setup();

    expect(
      (await send(alice, conversationId, { attachment: attachment({ kind: "executable" }) })).status
    ).toBe(400);
    expect((await send(alice, conversationId, { attachment: "not-an-object" })).status).toBe(400);
    expect(
      (await send(alice, conversationId, { attachment: attachment({ url: 12 }) })).status
    ).toBe(400);
  });

  it("rejects an absurd filename", async () => {
    const { alice, conversationId } = await setup();
    const res = await send(alice, conversationId, {
      attachment: attachment({ name: "x".repeat(300) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("MSG-09 — link preview safety", () => {
  it("finds the first URL in a message", () => {
    expect(firstUrlIn("look at https://example.com/x please")).toBe("https://example.com/x");
    expect(firstUrlIn("no links here")).toBeNull();
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["IPv6 loopback", "::1"],
    ["cloud metadata", "169.254.169.254"],
    ["private 10.x", "10.0.0.5"],
    ["private 192.168.x", "192.168.1.1"],
    ["private 172.16.x", "172.20.10.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["unique local IPv6", "fd00::1"],
    ["link-local IPv6", "fe80::1"],
    ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1"],
    ["multicast", "239.0.0.1"],
    ["not an address at all", "hello"],
  ])("blocks %s", (_label, address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["1.1.1.1"], ["2606:4700:4700::1111"]])(
    "allows the public address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it("refuses a non-http protocol without fetching", async () => {
    const fetchImpl = vi.fn();
    expect(await resolveLinkPreview("file:///etc/passwd", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a literal private address without fetching", async () => {
    const fetchImpl = vi.fn();
    expect(await resolveLinkPreview("http://169.254.169.254/latest/meta-data", { fetchImpl }))
      .toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-checks after a redirect, so a public URL cannot bounce inward", async () => {
    // the whole attack: example.com 302s to the metadata endpoint
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Map([["location", "http://169.254.169.254/latest/meta-data"]]),
    });
    fetchImpl.mockResolvedValue({
      status: 302,
      headers: { get: (key) => (key === "location" ? "http://169.254.169.254/" : null) },
    });

    const preview = await resolveLinkPreview("https://example.com", { fetchImpl });

    expect(preview).toBeNull();
    // it fetched the first hop, then refused to follow inward
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses Open Graph tags from a public page", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Example Domain" />
        <meta property="og:description" content="An example page" />
        <meta property="og:image" content="https://example.com/card.png" />
      </head></html>`;

    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (key) => (key === "content-type" ? "text/html; charset=utf-8" : null) },
      text: async () => html,
    });

    const preview = await resolveLinkPreview("https://example.com", { fetchImpl });

    expect(preview.title).toBe("Example Domain");
    expect(preview.description).toBe("An example page");
    expect(preview.image).toBe("https://example.com/card.png");
  });

  it("returns null for a page with nothing worth previewing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (key) => (key === "content-type" ? "text/html" : null) },
      text: async () => "<html><body>nothing</body></html>",
    });

    expect(await resolveLinkPreview("https://example.com", { fetchImpl })).toBeNull();
  });

  it("ignores a non-HTML response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (key) => (key === "content-type" ? "application/pdf" : null) },
      text: async () => "%PDF",
    });

    expect(await resolveLinkPreview("https://example.com", { fetchImpl })).toBeNull();
  });

  it("degrades to null rather than throwing when the fetch fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await resolveLinkPreview("https://example.com", { fetchImpl })).toBeNull();
  });
});
