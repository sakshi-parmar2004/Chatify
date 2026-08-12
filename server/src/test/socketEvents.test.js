import { describe, it, expect, vi } from "vitest";
import { consumeToken } from "../lib/socketRateLimit.js";
import { INBOUND_EVENTS, registerInboundEvents } from "../lib/socketEvents.js";

const ALICE = "507f1f77bcf86cd799439011";
const CONVERSATION = "507f1f77bcf86cd799439012";
const OTHER_CONVERSATION = "507f1f77bcf86cd799439013";

/**
 * Stands in for a Socket.IO socket. `rooms` matters: conversation events are
 * authorized by room membership, which the server granted at connect time.
 */
const makeSocket = ({ rooms = [`conversation:${CONVERSATION}`] } = {}) => {
  const handlers = new Map();
  const emitted = [];

  return {
    rooms: new Set(rooms),
    emitted,
    on: (name, fn) => handlers.set(name, fn),
    fire: (name, payload) => handlers.get(name)?.(payload),
    names: () => [...handlers.keys()].sort((a, b) => a.localeCompare(b)),
    to: vi.fn((room) => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    })),
  };
};

const context = { userId: ALICE };

describe("per-socket rate limit", () => {
  const limit = { capacity: 3, perSecond: 1 };

  it("allows a burst up to capacity, then refuses", () => {
    const socket = {};
    expect([0, 1, 2].map(() => consumeToken(socket, "e", limit))).toEqual([true, true, true]);
    expect(consumeToken(socket, "e", limit)).toBe(false);
  });

  it("budgets each event separately", () => {
    const socket = {};
    [0, 1, 2].forEach(() => consumeToken(socket, "e", limit));
    expect(consumeToken(socket, "other", limit)).toBe(true);
  });

  it("refills over time", () => {
    const socket = {};
    [0, 1, 2].forEach(() => consumeToken(socket, "e", limit));
    expect(consumeToken(socket, "e", limit)).toBe(false);

    // rewind the bucket's clock rather than sleeping
    const buckets = socket[Object.getOwnPropertySymbols(socket)[0]];
    buckets.get("e").updatedAt -= 2000;

    expect(consumeToken(socket, "e", limit)).toBe(true);
  });

  it("keeps the budget on the socket, so reconnecting is the only reset", () => {
    const a = {};
    const b = {};
    [0, 1, 2].forEach(() => consumeToken(a, "e", limit));
    expect(consumeToken(a, "e", limit)).toBe(false);
    expect(consumeToken(b, "e", limit)).toBe(true);
  });
});

describe("inbound event registry", () => {
  it("registers exactly the declared events and nothing else", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);
    expect(socket.names()).toEqual(Object.keys(INBOUND_EVENTS).sort((a, b) => a.localeCompare(b)));
  });

  it("relays typing to the conversation room, excluding the sender", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    socket.fire("typing", { conversationId: CONVERSATION });

    // socket.to() rather than io.to() — you do not need to be told you are typing
    expect(socket.emitted).toEqual([
      {
        room: `conversation:${CONVERSATION}`,
        event: "userTyping",
        payload: { conversationId: CONVERSATION, userId: ALICE },
      },
    ]);
  });

  it("relays stopTyping", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    socket.fire("stopTyping", { conversationId: CONVERSATION });
    expect(socket.emitted[0].event).toBe("userStoppedTyping");
  });

  it("drops an event for a conversation the socket is not in", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    // a well-formed id the caller has no membership of: room membership is the
    // authorization boundary, and it costs no database round trip
    socket.fire("typing", { conversationId: OTHER_CONVERSATION });

    expect(socket.emitted).toEqual([]);
    expect(socket.to).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a non-id string", { conversationId: "not-an-id" }],
    ["a number", { conversationId: 42 }],
    ["a query operator", { conversationId: { $ne: null } }],
    ["an array", { conversationId: [CONVERSATION] }],
  ])("drops %s before it reaches a handler", (_label, payload) => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    socket.fire("typing", payload);

    // asserting "nothing emitted" alone would also pass with validation removed
    expect(socket.to).not.toHaveBeenCalled();
    expect(socket.emitted).toEqual([]);
  });

  it("takes the sender from the socket, never from the payload", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    socket.fire("typing", {
      conversationId: CONVERSATION,
      userId: "attacker",
      fromUserId: "attacker",
    });

    expect(socket.emitted[0].payload.userId).toBe(ALICE);
  });

  it("caps a flood at the burst allowance", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    for (let i = 0; i < 50; i += 1) socket.fire("typing", { conversationId: CONVERSATION });

    expect(socket.emitted).toHaveLength(INBOUND_EVENTS.typing.limit.capacity);
  });

  it("charges malformed payloads too, so a garbage flood is still bounded", () => {
    const socket = makeSocket();
    registerInboundEvents(socket, context);

    const { capacity } = INBOUND_EVENTS.typing.limit;
    for (let i = 0; i < capacity; i += 1) socket.fire("typing", { conversationId: "junk" });

    socket.fire("typing", { conversationId: CONVERSATION });
    expect(socket.emitted).toEqual([]);
  });

  it("contains a throwing handler instead of dropping the connection", () => {
    const socket = makeSocket();
    socket.to = () => {
      throw new Error("boom");
    };
    registerInboundEvents(socket, context);

    expect(() => socket.fire("typing", { conversationId: CONVERSATION })).not.toThrow();
  });
});
