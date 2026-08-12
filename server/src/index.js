import { log } from "./lib/logger.js";
import connectDB from "./lib/db.js";
import { env_variable } from "./lib/env.js";
import { server } from "./lib/socket.js";
// configures the Express app shared with the HTTP server above; imported for
// that effect, so it must come before listen()
import "./app.js";

const PORT = env_variable.PORT;

// connect before accepting traffic, so early requests are not left waiting on
// Mongoose's buffer
await connectDB();

server.listen(PORT, () => {
  log.info({ port: PORT }, "server listening");
});

const shutdown = (signal) => {
  log.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
  // don't hang forever on lingering sockets
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
