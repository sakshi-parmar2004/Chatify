import { log } from "../lib/logger.js";
import jwt from "jsonwebtoken";
import { env_variable } from "../lib/env.js";
import User from "../models/user.model.js";

export const protectRoute = async (req, res, next) => {
  // Read the JWT from the cookie named "token".
  // This only works if the server has cookie-parser enabled.
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    // Verify the token signature and expiration.
    const decoded = jwt.verify(token, env_variable.JWT_SECRET);

    // The token payload created in generateToken.js uses "id",
    // so we check for that instead of "_id".
    if (!decoded?.id) {
      return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }
    
    // Attach the decoded user info to the request object so later handlers can use it.
    const userInfo = await User.findById(decoded.id).select("-password"); // Exclude password from the user info
    if (!userInfo) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }
    req.user = userInfo; // Attach user info to the request object
    next();
  } catch (error) {
    log.debug({ err: error }, "auth rejected");
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};
