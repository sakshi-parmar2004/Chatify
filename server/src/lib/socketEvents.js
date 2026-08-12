import mongoose from "mongoose";
import { consumeToken } from "./socketRateLimit.js";

/**
 * The client -> server socket contract.
 *
 * Until this file existed the socket channel was one-directional: the server
 * emitted and the only inbound handler was `disconnect`. Everything inbound now
 * goes through one registry so that validation, rate limiting and identity
 * handling cannot be forgotten on the next event someone adds.
 *
 * Three rules hold for every entry:
 *
 *   1. Identity comes from `socket.userId`, which the auth middleware set from
 *      the signed cookie. A payload never says who the sender is.
 *   2. Every payload is validated before it reaches a handler. Anything that
 *      fails is dropped, not answered — a malformed event is not worth a round
 *      trip and an error reply is a free amplification primitive.
 *   3. Every event is charged against a per-socket budget.
 *
 * `validate` returns the cleaned value or null. Handlers receive `(context,
 * value)`, where context carries `io`, `getReceiverSocketIds` and `userId` —
 * injected rather than imported, because socket.js imports this module and the
 * reverse import would be a cycle.
 */

const isObjectId = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value);

// Typing is the noisiest thing a client can send, so it is also the cheapest to
// abuse: it fans out to every one of the recipient's sockets. The client
// throttles to roughly one event every two seconds; this leaves room for a
// burst without leaving room for a per-keystroke flood.
const TYPING_LIMIT = { capacity: 6, perSecond: 2 };

const notifyPartner = ({ io, getReceiverSocketIds, userId }, toUserId, event) => {
  for (const socketId of getReceiverSocketIds(toUserId)) {
    io.to(socketId).emit(event, { fromUserId: userId });
  }
};

export const INBOUND_EVENTS = {
  typing: {
    limit: TYPING_LIMIT,
    validate: (payload) => (isObjectId(payload?.toUserId) ? payload.toUserId : null),
    handle: (context, toUserId) => notifyPartner(context, toUserId, "userTyping"),
  },

  stopTyping: {
    limit: TYPING_LIMIT,
    validate: (payload) => (isObjectId(payload?.toUserId) ? payload.toUserId : null),
    handle: (context, toUserId) => notifyPartner(context, toUserId, "userStoppedTyping"),
  },
};

export const registerInboundEvents = (socket, context) => {
  for (const [name, { validate, handle, limit }] of Object.entries(INBOUND_EVENTS)) {
    socket.on(name, (payload) => {
      if (!consumeToken(socket, name, limit)) return;

      const value = validate(payload);
      if (value === null) return;

      try {
        handle(context, value);
      } catch (error) {
        // a broken handler must not take the connection down with it
        console.error(`Error handling socket event "${name}":`, error.message);
      }
    });
  }
};
