import dotenv from "dotenv";
dotenv.config();

export const env_variable={
    PORT: process.env.PORT || 8000,
    NODE_ENV: process.env.NODE_ENV || "development",
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    ARCJET_KEY:process.env.ARCJET_KEY,
    ARCJET_ENV: process.env.ARCJET_ENV || "development",
    CLIENT_URL:process.env.CLIENT_URL,
    // "strict" is safe when the client is served from the same origin as the API.
    // Set to "none" (which forces secure cookies) when the client is on another domain.
    COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || "strict",
    // NTF-01. Optional: without a key pair the app runs exactly as before and
    // push is skipped, so a missing value must not stop the server booting.
    // Generate with: npx web-push generate-vapid-keys
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    // OBS-04. Comma-separated; these accounts are promoted to admin on login.
    // Optional — with none set, the only path to admin is scripts/grantAdmin.js.
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
}

// Fail fast at boot rather than on the first request that needs a missing key.
const REQUIRED_KEYS = [
  "MONGO_URI",
  "JWT_SECRET",
  "CLIENT_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "ARCJET_KEY",
];

const missing = REQUIRED_KEYS.filter((key) => !env_variable[key]);

if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(", ")}\n` +
      `Copy .env.example to .env and fill in the values.`
  );
  process.exit(1);
}

if (!["strict", "lax", "none"].includes(env_variable.COOKIE_SAMESITE)) {
  console.error(`COOKIE_SAMESITE must be one of "strict", "lax", or "none".`);
  process.exit(1);
}
