/**
 * OBS-04 — promote an account to admin.
 *
 *   node src/scripts/grantAdmin.js someone@example.com
 *   node src/scripts/grantAdmin.js someone@example.com --revoke
 *
 * One of two bootstrap paths, deliberately. The ADMIN_EMAILS allowlist promotes
 * on login, which is convenient but requires a redeploy to change; this works
 * against a running database and is how you recover if the allowlist is wrong
 * or the first admin loses access.
 */
import mongoose from "mongoose";
import connectDB from "../lib/db.js";
import User from "../models/user.model.js";
import { recordEvent } from "../lib/audit.js";

const email = process.argv[2];
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error("Usage: node src/scripts/grantAdmin.js <email> [--revoke]");
  process.exit(1);
}

await connectDB();

try {
  const role = revoke ? "user" : "admin";
  const user = await User.findOneAndUpdate(
    { email: String(email).trim().toLowerCase() },
    { $set: { role } },
    { new: true }
  ).select("name email role");

  if (!user) {
    console.error(`No account with the email ${email}`);
    process.exitCode = 1;
  } else {
    // the grant is itself auditable — that is the point of an audit log
    recordEvent({
      actorId: user._id,
      action: "user.role_granted",
      targetType: "user",
      targetId: user._id,
      metadata: { role, via: "cli" },
    });
    console.log(`${user.name} <${user.email}> is now ${user.role}`);
    // the audit write is fire-and-forget; give it a moment before exiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
} finally {
  await mongoose.disconnect();
}
