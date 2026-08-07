import jwt from "jsonwebtoken";
import {env_variable} from "./env.js";

export const generateToken = (user, res) => {
  const token = jwt.sign({ id: user._id }, env_variable.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true, //prevents cross-site scripting (XSS) attacks by restricting access to the cookie from client-side scripts
    secure: env_variable.NODE_ENV === "production", // Set to true in production
    sameSite: "strict", // Adjust this based on your requirements
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  return token;
}

