import express from 'express'
import { Server } from "socket.io";
import http from "http";
import { env_variable } from "./env.js";
import { socketAuthMiddleware } from "../middleware/socket.auth.middleware.js";
import { registerInboundEvents } from "./socketEvents.js";
import { flushDeliveredForUser, conversationIdsFor } from "./delivery.js";

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

export const isOnline = (userId) => getReceiverSocketIds(userId).length > 0;

/**
 * PLT-04 — conversation-scoped rooms.
 *
 * Delivery used to be an application-level fan-out: resolve every recipient's
 * socket ids and loop. That is O(participants x sockets) in our own code and
 * does not survive groups. A room is one emit regardless of who is in it.
 *
 * Room membership is the authorization boundary, which makes leaving one a
 * security operation rather than a tidy-up — see removeFromConversationRoom.
 */
export const conversationRoom = (conversationId) => `conversation:${conversationId}`;

/** Put every currently-connected participant into the conversation's room. */
export const joinConversationRoom = (conversation) => {
  const room = conversationRoom(conversation._id);
  for (const participantId of conversation.participants) {
    for (const socketId of getReceiverSocketIds(participantId)) {
      io.in(socketId).socketsJoin(room);
    }
  }
};

/**
 * Drop a user out of a conversation's room across every tab they have open.
 * A removed member who stays in the room keeps receiving messages, so this is
 * not optional cleanup.
 */
export const removeFromConversationRoom = (conversationId, userId) => {
  const room = conversationRoom(conversationId);
  for (const socketId of getReceiverSocketIds(userId)) {
    io.in(socketId).socketsLeave(room);
  }
};

export const emitToConversation = (conversation, event, payload) => {
  io.to(conversationRoom(conversation._id ?? conversation)).emit(event, payload);
};

/** Emit to one user across all their tabs, for things that are not conversation-scoped. */
export const emitToUser = (userId, event, payload) => {
  for (const socketId of getReceiverSocketIds(userId)) {
    io.to(socketId).emit(event, payload);
  }
};

io.on("connection", async (socket) => {
  const userId = socket.userId;

  if (!userSocketMap.has(userId)) userSocketMap.set(userId, new Set());
  userSocketMap.get(userId).add(socket.id);

  // io.emit() is used to send events to all connected clients
  io.emit("getOnlineUsers", [...userSocketMap.keys()]);

  // every client -> server event goes through the registry, which owns payload
  // validation and the per-socket rate limit
  registerInboundEvents(socket, {
    io,
    getReceiverSocketIds,
    emitToConversation,
    userId,
    socket,
  });

  socket.on("disconnect", () => {
    const sockets = userSocketMap.get(userId);
    if (!sockets) return;

    sockets.delete(socket.id);
    // only mark the user offline once their last connection closes
    if (sockets.size === 0) userSocketMap.delete(userId);

    io.emit("getOnlineUsers", [...userSocketMap.keys()]);
    // Nothing is emitted here to clear a "typing…" indicator: the server does
    // not track which conversation this socket was composing in. The client
    // expires the indicator on a timer instead, which also covers a dropped
    // stopTyping.
  });

  // This socket needs to be in its user's rooms before anything is emitted to
  // them, and anything written while they were away is only reaching a client
  // now. Both are fire-and-forget: a failure costs a tick, not a message.
  try {
    for (const conversationId of await conversationIdsFor(userId)) {
      socket.join(conversationRoom(conversationId));
    }

    for (const { conversation, lastDeliveredAt } of await flushDeliveredForUser(userId)) {
      emitToConversation(conversation, "conversationDelivered", {
        conversationId: String(conversation._id),
        userId,
        lastDeliveredAt,
      });
    }
  } catch (error) {
    console.error("Error preparing socket for", userId, "-", error.message);
  }
});

export { io, app, server };
