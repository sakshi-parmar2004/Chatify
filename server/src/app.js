import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import authRouter from "./routes/auth.route.js";
import messageRouter from "./routes/message.route.js";
import conversationRouter from "./routes/conversation.route.js";
import notificationRouter from "./routes/notification.route.js";
import { isDbConnected } from "./lib/db.js";
import { env_variable } from "./lib/env.js";
import { app } from "./lib/socket.js";

// The Express app is configured here rather than in index.js so that it can be
// imported without also connecting to a database and binding a port. index.js
// owns the process lifecycle; this file owns the request pipeline.

const isProduction = env_variable.NODE_ENV === "production";

app.disable("x-powered-by");
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

// Central error handler. Express only routes here when next(error) is called or
// a synchronous handler throws, so controllers still catch their own errors.
app.use((error, _req, res, _next) => {
  console.error("Unhandled error:", error.message);
  res.status(error.status || 500).json({ message: "Server error" });
});

export { app };
