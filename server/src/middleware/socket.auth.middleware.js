import { log } from "../lib/logger.js";
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { env_variable } from "../lib/env.js";

export const socketAuthMiddleware = async (socket, next) => {
  try {
    // extract token from http-only cookies
    const token = socket.handshake.headers.cookie
      ?.split("; ")
      .find((row) => row.startsWith("token="))
      ?.split("=")[1];

    if (!token) {
      log.debug("socket rejected: no token");
      return next(new Error("Unauthorized - No Token Provided"));
    }

    // verify the token
    const decoded = jwt.verify(token, env_variable.JWT_SECRET);
    if (!decoded) {
      log.debug("socket rejected: invalid token");
      return next(new Error("Unauthorized - Invalid Token"));
    }

    // find the user fromdb
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      log.debug("socket rejected: unknown user");
      return next(new Error("User not found"));
    }

    // attach user info to socket
    socket.user = user;
    socket.userId = user._id.toString();

    next();
  } catch (error) {
    log.warn({ err: error }, "socket authentication failed");
    next(new Error("Unauthorized - Authentication failed"));
  }
};