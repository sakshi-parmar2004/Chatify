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
