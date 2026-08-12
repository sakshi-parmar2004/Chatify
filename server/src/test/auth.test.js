import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

// Arcjet, Cloudinary and Resend are the three edges that reach the network.
// Mocked rather than fed dummy keys: with a bad key Arcjet throws, and the
// strict variant guarding /register and /login fails closed with a 503, so
// every auth test would fail for a reason that has nothing to do with auth.
vi.mock("../middleware/arcjet.middleware.js", () => ({
  arcjetProtection: (_req, _res, next) => next(),
  strictArcjetProtection: (_req, _res, next) => next(),
}));
vi.mock("../lib/email.js", () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/cloudinary.js", () => ({
  default: { uploader: { upload: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/p.jpg" }) } },
}));

const { app } = await import("../app.js");
const { connectTestDb, disconnectTestDb, clearCollections, cookieFrom, registerUser, startTestServer, stopTestServer } =
  await import("./helpers.js");

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

describe("POST /api/auth/register", () => {
  it("creates a user, sets an httpOnly cookie, and never returns the password", async () => {
    const res = await request(server)
      .post("/api/auth/register")
      .send({ name: "Ada", email: "ada@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.email).toBe("ada@example.com");

    const cookie = res.headers["set-cookie"].join(";");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite/i);
  });

  it("normalises the email so casing and whitespace cannot create a duplicate", async () => {
    await request(server)
      .post("/api/auth/register")
      .send({ name: "Ada", email: "  Ada@Example.COM ", password: "password123" });

    const res = await request(server)
      .post("/api/auth/register")
      .send({ name: "Imposter", email: "ada@example.com", password: "password123" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("User already exists");
  });

  it.each([
    ["a missing field", { name: "Ada", email: "ada@example.com" }],
    ["a short password", { name: "Ada", email: "ada@example.com", password: "12345" }],
    ["a malformed email", { name: "Ada", email: "not-an-email", password: "password123" }],
  ])("rejects %s", async (_label, payload) => {
    const res = await request(server).post("/api/auth/register").send(payload);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    const user = await registerUser(request, server);

    const res = await request(server)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user._id).toBe(user.id);
    expect(cookieFrom(res)).not.toHaveLength(0);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const user = await registerUser(request, server);

    const wrongPassword = await request(server)
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password" });
    const unknownEmail = await request(server)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    // leaking which half was wrong hands an attacker a user enumeration oracle
    expect(wrongPassword.status).toBe(400);
    expect(unknownEmail.status).toBe(400);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });
});

describe("session round trip", () => {
  it("restores the session with the cookie and drops it after logout", async () => {
    const user = await registerUser(request, server);

    const authed = await request(server).get("/api/auth/get-user").set("Cookie", user.cookie);
    expect(authed.status).toBe(200);
    expect(authed.body.user._id).toBe(user.id);

    const logout = await request(server).post("/api/auth/logout").set("Cookie", user.cookie);
    expect(logout.status).toBe(200);

    // the cleared cookie must match the options it was set with, or the browser
    // keeps the old one and logout silently does nothing
    const cleared = cookieFrom(logout).join(";");
    expect(cleared).toMatch(/token=/);
  });

  it("refuses an unauthenticated request", async () => {
    const res = await request(server).get("/api/auth/get-user");
    expect(res.status).toBe(401);
  });

  it("refuses a forged token", async () => {
    const res = await request(server)
      .get("/api/auth/get-user")
      .set("Cookie", ["token=not.a.real.jwt"]);
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/auth/update-profile", () => {
  it("rejects a non-image payload before it reaches Cloudinary", async () => {
    const user = await registerUser(request, server);

    const res = await request(server)
      .put("/api/auth/update-profile")
      .set("Cookie", user.cookie)
      .send({ profilePic: "https://evil.test/internal-metadata" });

    expect(res.status).toBe(400);
  });

  it("stores the uploaded URL", async () => {
    const user = await registerUser(request, server);
    const dataUri = `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`;

    const res = await request(server)
      .put("/api/auth/update-profile")
      .set("Cookie", user.cookie)
      .send({ profilePic: dataUri });

    expect(res.status).toBe(200);
    expect(res.body.updatedUser.profilePic).toBe("https://cdn.test/p.jpg");
    expect(res.body.updatedUser.password).toBeUndefined();
  });

  it("requires authentication", async () => {
    const res = await request(server).put("/api/auth/update-profile").send({ profilePic: "x" });
    expect(res.status).toBe(401);
  });
});
