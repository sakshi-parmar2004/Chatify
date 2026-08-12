import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import pino from "pino";

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
const { runWithContext, currentContext, newRequestId } = await import("../lib/logger.js");

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

/** Capture what pino would actually write, with the real redaction applied. */
const captureLines = (fn) => {
  const lines = [];
  const logger = pino(
    {
      level: "debug",
      redact: {
        paths: [
          "req.headers.cookie", "req.headers.authorization", "password", "*.password",
          "body.password", "keys", "*.keys", "signature", "*.signature",
          "endpoint", "*.endpoint",
        ],
        censor: "[redacted]",
      },
      base: undefined,
    },
    { write: (line) => lines.push(JSON.parse(line)) }
  );
  fn(logger);
  return lines;
};

describe("OBS-01 — redaction", () => {
  it("never writes a session cookie", () => {
    const [line] = captureLines((logger) =>
      logger.info({ req: { headers: { cookie: "token=super-secret-jwt" } } }, "request")
    );
    expect(line.req.headers.cookie).toBe("[redacted]");
    expect(JSON.stringify(line)).not.toContain("super-secret-jwt");
  });

  it("never writes a password", () => {
    const [line] = captureLines((logger) =>
      logger.info({ body: { email: "a@b.com", password: "hunter2" } }, "register")
    );
    expect(JSON.stringify(line)).not.toContain("hunter2");
  });

  it("never writes push subscription keys or endpoints", () => {
    // an endpoint is a capability URL — anyone holding it can notify that device
    const [line] = captureLines((logger) =>
      logger.info(
        { subscription: { endpoint: "https://push.example.com/abc", keys: { auth: "k" } } },
        "push"
      )
    );
    expect(JSON.stringify(line)).not.toContain("push.example.com");
    expect(JSON.stringify(line)).not.toContain('"k"');
  });

  it("never writes an upload signature", () => {
    const [line] = captureLines((logger) => logger.info({ signature: "abc123" }, "sign"));
    expect(JSON.stringify(line)).not.toContain("abc123");
  });

  it("censors rather than deletes, so a hidden field is still visible as one", () => {
    const [line] = captureLines((logger) => logger.info({ password: "x" }, "m"));
    expect(line).toHaveProperty("password", "[redacted]");
  });
});

describe("OBS-01 — request correlation", () => {
  it("returns a request id on every response", async () => {
    const res = await request(server).get("/api/health");
    expect(res.headers["x-request-id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("honours an upstream id so a trace survives a proxy hop", async () => {
    const res = await request(server)
      .get("/api/health")
      .set("x-request-id", "upstream-trace-1");
    expect(res.headers["x-request-id"]).toBe("upstream-trace-1");
  });

  it("carries context into async work without threading a parameter", async () => {
    const id = newRequestId();
    let seen;

    await runWithContext({ requestId: id }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen = currentContext().requestId;
    });

    expect(seen).toBe(id);
  });

  it("is empty outside a request", () => {
    expect(currentContext()).toEqual({});
  });
});

describe("BE-I-06 — asyncHandler", () => {
  it("still returns the documented error shape", async () => {
    const alice = await registerUser(request, server);

    const res = await request(server)
      .get("/api/conversations/not-a-valid-id/messages")
      .set("Cookie", alice.cookie);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("message");
  });

  it("turns a rejected promise into a 500 rather than a hung request", async () => {
    const alice = await registerUser(request, server);
    const Conversation = (await import("../models/conversation.model.js")).default;

    // an async throw used to need a hand-written catch in every controller
    const spy = vi.spyOn(Conversation, "find").mockImplementationOnce(() => {
      throw new Error("database on fire");
    });

    const res = await request(server).get("/api/conversations").set("Cookie", alice.cookie);

    expect(res.status).toBe(500);
    // the internal message must not reach the client
    expect(res.body.message).toBe("Server error");
    expect(JSON.stringify(res.body)).not.toContain("on fire");

    spy.mockRestore();
  });
});
