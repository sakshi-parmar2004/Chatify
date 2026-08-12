import jwt from "jsonwebtoken";
import {env_variable} from "./env.js";

const isProduction = env_variable.NODE_ENV === "production";

// SameSite=None is only honoured on secure cookies, so it implies HTTPS.
// Shared by generateToken and logout so clearCookie matches what was set —
// a mismatch leaves the cookie in place.
export const authCookieOptions = {
  httpOnly: true, //prevents cross-site scripting (XSS) attacks by restricting access to the cookie from client-side scripts
  secure: isProduction || env_variable.COOKIE_SAMESITE === "none",
  sameSite: env_variable.COOKIE_SAMESITE,
};

export const generateToken = (user, res) => {
  const token = jwt.sign({ id: user._id }, env_variable.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    ...authCookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  return token;
}
