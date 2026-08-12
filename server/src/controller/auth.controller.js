import { asyncHandler } from "../lib/asyncHandler.js";
import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import { generateToken, authCookieOptions } from "../lib/generateToken.js";
import { sendWelcomeEmail } from "../lib/email.js";
import cloudinary from "../lib/cloudinary.js";
import { validateImageDataUri } from "../lib/validateImage.js";
import { recordEvent } from "../lib/audit.js";
import { env_variable } from "../lib/env.js";

/**
 * OBS-04 — the allowlist bootstrap.
 *
 * Applied at login rather than at registration so adding an email promotes an
 * existing account on their next sign-in, without a database edit.
 */
const adminEmails = new Set(
  (env_variable.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

export const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if(!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }
    try {
if(password.length < 6) {
  return res.status(400).json({ message: "Password must be at least 6 characters long" });
}

// Normalise before validating, not after. The regex rejects surrounding
// whitespace, and password managers and mobile keyboards routinely add a
// trailing space — validating the raw value turned that into "Invalid email
// format" for an address the schema would have stored happily.
const normalizedEmail = String(email).trim().toLowerCase();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if(!emailRegex.test(normalizedEmail)) {
  return res.status(400).json({ message: "Invalid email format" });
}

const alreadyExists = await User.findOne({ email: normalizedEmail });
if(alreadyExists) {
  return res.status(400).json({ message: "User already exists" });
}
const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = await User.create({ name, email: normalizedEmail,  password: hashedPassword });

  generateToken(newUser, res);
  recordEvent({ actorId: newUser._id, action: "user.register", req });
  await sendWelcomeEmail(name, normalizedEmail);

  res.status(201).json({ message: "User registered successfully", user: newUser });

    }

    catch (error) {
        // findOne + create is a check-then-act race; the unique index is what
        // actually enforces uniqueness, so treat its error as the same 400.
        // Anything else is not ours to interpret — let the error handler log it.
        if (error.code === 11000) {
          return res.status(400).json({ message: "User already exists" });
        }
        throw error;
    }
})

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if(!email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  // never reveal whether the email or the password was wrong — the difference
  // is a user-enumeration oracle
  if (!user) {
    return res.status(400).json({ message: "Invalid Credentials" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Invalid Credentials" });
  }

  // promote before the token is issued, so the session carries the role
  if (adminEmails.has(user.email) && user.role !== "admin") {
    user.role = "admin";
    await user.save();
    recordEvent({
      actorId: user._id,
      action: "user.role_granted",
      targetType: "user",
      targetId: user._id,
      metadata: { role: "admin", via: "allowlist" },
      req,
    });
  }

  generateToken(user, res);
  recordEvent({ actorId: user._id, action: "user.login", req });
  res.status(200).json({ message: "Login successful", user });
})

export const logoutUser = (_, res) => {
  // options must match the ones the cookie was set with, or it is not cleared
  res.clearCookie("token", authCookieOptions);
  res.status(200).json({ message: "Logout successful" });
};

export const update_profile = asyncHandler(async (req, res) => {
  const {  profilePic } = req.body;
  if(!profilePic) {
    return res.status(400).json({ message: "Profile picture is required" });
  }

  const validation = validateImageDataUri(profilePic);
  if (!validation.ok) {
    return res.status(400).json({ message: validation.message });
  }

  const { secure_url } = await cloudinary.uploader.upload(profilePic, { folder: "profile_pics" });
  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { profilePic: secure_url },
    { new: true }
  ).select("-password");

  recordEvent({ actorId: req.user._id, action: "user.profile_updated", req });
  res.status(200).json({ updatedUser, message: "Profile picture updated successfully" });
});
