import express from 'express'
import { Server } from "socket.io";
import http from "http";
import { env_variable } from "./env.js";
import { socketAuthMiddleware } from "../middleware/socket.auth.middleware.js";
import { registerInboundEvents } from "./socketEvents.js";
import { flushDeliveredForUser, conversationIdsFor, contactIdsFor } from "./delivery.js";
import User from "../models/user.model.js";

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

/** Tell only the people who share a conversation with this user (PLT-05). */
const announcePresence = async (userId, online) => {
  try {
    for (const contactId of await contactIdsFor(userId)) {
      emitToUser(contactId, "presence", { userId, online });
    }
  } catch (error) {
    console.error("Error announcing presence for", userId, "-", error.message);
  }
};

io.on("connection", async (socket) => {
  const userId = socket.userId;

  // a second tab is not a new arrival, so it must not re-announce
  const isFirstConnection = !userSocketMap.has(userId) || userSocketMap.get(userId).size === 0;

  if (!userSocketMap.has(userId)) userSocketMap.set(userId, new Set());
  userSocketMap.get(userId).add(socket.id);

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

    // PLT-05: only people who share a conversation are told, and only when the
    // last tab closes.
    if (sockets.size === 0) {
      // NTF-07 — stamped on the way out, so "last seen" is when they actually left
      void User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } }).catch(
        (error) => console.error("Error stamping lastSeenAt:", error.message)
      );
      void announcePresence(userId, false);
    }
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

    // PLT-05 — presence is a scoped notification, not a broadcast. Sent after
    // the rooms are joined so a contact learning we are online can already
    // reach us.
    const contactIds = await contactIdsFor(userId);
    if (isFirstConnection) {
      for (const contactId of contactIds) {
        emitToUser(contactId, "presence", { userId, online: true });
      }
    }

    // and tell this socket who among its own contacts is already online
    socket.emit(
      "getOnlineUsers",
      contactIds.filter((contactId) => isOnline(contactId))
    );

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
