// Runs before any module under test is imported.
//
// lib/env.js calls dotenv.config() and process.exit(1) when a required key is
// missing. dotenv does not overwrite variables that are already set, so filling
// every required key here does two things at once: it lets the module load, and
// it guarantees no real credential from .env is ever used by a test.
const TEST_ENV = {
  NODE_ENV: "test",
  PORT: "0",
  MONGO_URI: "mongodb://127.0.0.1:0/unused-tests-connect-directly",
  JWT_SECRET: "test-secret-not-used-anywhere-real",
  CLIENT_URL: "http://localhost:5173",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "test@example.com",
  EMAIL_FROM_NAME: "Chatify Test",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
  ARCJET_KEY: "ajkey_test",
  ARCJET_ENV: "development",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}
