import mongoose from "mongoose";
import { consumeToken } from "./socketRateLimit.js";

/**
 * The client -> server socket contract.
 *
 * Everything inbound goes through one registry so that validation, rate
 * limiting and identity handling cannot be forgotten on the next event someone
 * adds.
 *
 * Four rules hold for every entry:
 *
 *   1. Identity comes from `socket.userId`, which the auth middleware set from
 *      the signed cookie. A payload never says who the sender is.
 *   2. Every payload is validated before it reaches a handler. Anything that
 *      fails is dropped, not answered — a malformed event is not worth a round
 *      trip and an error reply is a free amplification primitive.
 *   3. Every event is charged against a per-socket budget.
 *   4. Anything conversation-scoped is authorized by room membership, which the
 *      server granted at connect time. That is an O(1) check with no database
 *      round trip, which matters for something sent while typing.
 */

const isObjectId = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value);

// Typing is the noisiest thing a client can send, and it fans out to every
// participant. The client throttles to roughly one event every two seconds;
// this leaves room for a burst without leaving room for a per-keystroke flood.
const TYPING_LIMIT = { capacity: 6, perSecond: 2 };

/**
 * Membership check without touching the database: the server put this socket
 * into the room, so being in it *is* the proof. A client that fakes a
 * conversationId is simply not in that room and the event dies here.
 */
const inConversation = (socket, conversationId) =>
  socket.rooms.has(`conversation:${conversationId}`);

const relayTyping = (event) => ({ socket, userId }, conversationId) => {
  if (!inConversation(socket, conversationId)) return;

  // to the room minus this socket — you do not need to be told you are typing
  socket.to(`conversation:${conversationId}`).emit(event, { conversationId, userId });
};

export const INBOUND_EVENTS = {
  typing: {
    limit: TYPING_LIMIT,
    validate: (payload) =>
      isObjectId(payload?.conversationId) ? payload.conversationId : null,
    handle: relayTyping("userTyping"),
  },

  stopTyping: {
    limit: TYPING_LIMIT,
    validate: (payload) =>
      isObjectId(payload?.conversationId) ? payload.conversationId : null,
    handle: relayTyping("userStoppedTyping"),
  },
};

export const registerInboundEvents = (socket, context) => {
  for (const [name, { validate, handle, limit }] of Object.entries(INBOUND_EVENTS)) {
    socket.on(name, (payload) => {
      if (!consumeToken(socket, name, limit)) return;

      const value = validate(payload);
      if (value === null) return;

      try {
        handle({ ...context, socket }, value);
      } catch (error) {
        // a broken handler must not take the connection down with it
        console.error(`Error handling socket event "${name}":`, error.message);
      }
    });
  }
};
