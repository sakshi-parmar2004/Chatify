import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import authRouter from "./routes/auth.route.js";
import messageRouter from "./routes/message.route.js";
import conversationRouter from "./routes/conversation.route.js";
import notificationRouter from "./routes/notification.route.js";
import preferencesRouter from "./routes/preferences.route.js";
import adminRouter from "./routes/admin.route.js";
import logsRouter from "./routes/logs.route.js";
import { isDbConnected } from "./lib/db.js";
import { env_variable } from "./lib/env.js";
import { app } from "./lib/socket.js";
import { requestContext } from "./middleware/logging.middleware.js";
import { log } from "./lib/logger.js";

// The Express app is configured here rather than in index.js so that it can be
// imported without also connecting to a database and binding a port. index.js
// owns the process lifecycle; this file owns the request pipeline.

const isProduction = env_variable.NODE_ENV === "production";

app.disable("x-powered-by");
// first, so every downstream log line carries the request id
app.use(requestContext);
app.use(
  helmet({
    // Helmet's default CSP is default-src 'self', which would block the
    // Cloudinary-hosted avatars and message images and the socket connection.
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
            mediaSrc: ["'self'"], // notification and keystroke sounds
            connectSrc: ["'self'", "ws:", "wss:"], // socket.io transport
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false, // Vite's dev server injects inline scripts and styles
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser()); // Parse cookies from incoming requests so req.cookies works
app.use(
  cors({
    origin: env_variable.CLIENT_URL,
    credentials: true,
  })
);

const __dirname = path.resolve();

app.get("/api/health", (_, res) => {
  const dbConnected = isDbConnected();
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "ok" : "degraded",
    database: dbConnected ? "connected" : "disconnected",
  });
});

app.use("/api/conversations", conversationRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/preferences", preferencesRouter);
app.use("/api/logs", logsRouter);
app.use("/api/admin", adminRouter);
// PLT-01: the pre-migration surface. Still serves the contacts list and acts as
// a compatibility layer for conversation-unaware callers.
app.use("/api/messages", messageRouter);
app.use("/api/auth", authRouter);

//this is for production build of react app
if (isProduction) {
  app.use(express.static(path.join(__dirname, "../client/dist")));
  app.get("*", (_, res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });
}

/**
 * The only place a 500 is produced.
 *
 * Controllers are wrapped in asyncHandler, so a rejected promise lands here
 * rather than in thirty hand-written catch blocks (BE-I-06). The stack is
 * logged — the previous version dropped it and ignored the request entirely,
 * which left nothing to debug from.
 *
 * The client sees a generic message: an internal error message can carry a
 * collection name, a path, or a driver detail.
 */
app.use((error, req, res, _next) => {
  const status = error.status || 500;

  if (status >= 500) {
    log.error(
      { err: error, method: req.method, path: req.originalUrl, userId: req.user?._id ? String(req.user._id) : undefined },
      "unhandled error"
    );
  }

  if (res.headersSent) return;
  res.status(status).json({ message: status >= 500 ? "Server error" : error.message });
});

export { app };
