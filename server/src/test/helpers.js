import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { inject } from "vitest";

/**
 * Connect to the in-memory MongoDB started by globalSetup.
 *
 * Deliberately not connectDB() from lib/db.js: that reads MONGO_URI, and the
 * point of the test env is that MONGO_URI never points anywhere real.
 *
 * Each test file gets its own database. Vitest isolates files into separate
 * workers, so sharing one database meant a finishing file could dropDatabase()
 * out from under a file that was still running — which showed up as a different
 * test failing every few runs rather than as an obvious collision.
 */
export const connectTestDb = async () => {
  await mongoose.connect(inject("mongoUri"), { dbName: `test_${randomUUID()}` });
};

export const disconnectTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

/** Wipe every collection between tests so ordering cannot leak state. */
export const clearCollections = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
};

/** Pull the auth cookie off a login/register response for use with .set("Cookie", …). */
export const cookieFrom = (response) => {
  const header = response.headers["set-cookie"] ?? [];
  return header.map((cookie) => cookie.split(";")[0]);
};

let userCount = 0;

/**
 * Register a user through the real endpoint and return their id and cookie, so
 * tests exercise the same path a browser would rather than seeding the database
 * behind the API's back.
 */
export const registerUser = async (request, app, overrides = {}) => {
  userCount += 1;
  const payload = {
    name: `User ${userCount}`,
    email: `user${userCount}@example.com`,
    password: "password123",
    ...overrides,
  };

  const response = await request(app).post("/api/auth/register").send(payload);
  if (response.status !== 201) {
    throw new Error(`registerUser failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    id: response.body.user._id,
    email: payload.email,
    password: payload.password,
    name: payload.name,
    cookie: cookieFrom(response),
  };
};
