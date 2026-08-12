import express from 'express'
import { Server } from "socket.io";
import http from "http";
import { env_variable } from "./env.js";
import { socketAuthMiddleware } from "../middleware/socket.auth.middleware.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [env_variable.CLIENT_URL],
    credentials: true,
  },
});

// apply authentication middleware to all socket connections
io.use(socketAuthMiddleware);

// this is for storing online users. One user can have several sockets open
// (multiple tabs or devices), so each id maps to a set of socket ids.
const userSocketMap = new Map(); // {userId: Set<socketId>}

export function getReceiverSocketIds(userId) {
  return [...(userSocketMap.get(String(userId)) ?? [])];
}

io.on("connection", (socket) => {
  const userId = socket.userId;

  if (!userSocketMap.has(userId)) userSocketMap.set(userId, new Set());
  userSocketMap.get(userId).add(socket.id);

  // io.emit() is used to send events to all connected clients
  io.emit("getOnlineUsers", [...userSocketMap.keys()]);

  // with socket.on we listen for events from clients
  socket.on("disconnect", () => {
    const sockets = userSocketMap.get(userId);
    if (!sockets) return;

    sockets.delete(socket.id);
    // only mark the user offline once their last connection closes
    if (sockets.size === 0) userSocketMap.delete(userId);

    io.emit("getOnlineUsers", [...userSocketMap.keys()]);
  });
});

export { io, app, server };
