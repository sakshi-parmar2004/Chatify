import express from 'express'
import { Server } from "socket.io";
import http from "http";
import { env_variable } from "./env.js";
import { socketAuthMiddleware } from "../middleware/socket.auth.middleware.js";
import { markPendingAsDelivered } from "./receipts.js";
import { registerInboundEvents } from "./socketEvents.js";

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

  // Anything written while this user had no socket open is only reaching a
  // client now. Fire-and-forget: a failure here costs a tick, not a message, so
  // it must not take the connection down with it.
  markPendingAsDelivered(userId)
    .then((senderIds) => {
      if (senderIds.length === 0) return;

      const deliveredAt = new Date().toISOString();
      for (const senderId of senderIds) {
        for (const socketId of getReceiverSocketIds(senderId)) {
          io.to(socketId).emit("messagesDelivered", { partnerId: userId, deliveredAt });
        }
      }
    })
    .catch((error) => console.error("Error flushing delivered receipts:", error.message));

  // every client -> server event goes through the registry, which owns payload
  // validation and the per-socket rate limit
  registerInboundEvents(socket, { io, getReceiverSocketIds, userId });

  // with socket.on we listen for events from clients
  socket.on("disconnect", () => {
    const sockets = userSocketMap.get(userId);
    if (!sockets) return;

    sockets.delete(socket.id);
    // only mark the user offline once their last connection closes
    if (sockets.size === 0) userSocketMap.delete(userId);

    io.emit("getOnlineUsers", [...userSocketMap.keys()]);
    // Nothing is emitted here to clear a "typing…" indicator: the server does
    // not track who this socket was composing to, and finding out would mean
    // telling every online user. The client expires the indicator on a timer
    // instead, which also covers a dropped stopTyping.
  });
});

export { io, app, server };
