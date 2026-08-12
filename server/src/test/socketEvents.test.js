import { describe, it, expect, vi } from "vitest";
import { consumeToken } from "../lib/socketRateLimit.js";
import { INBOUND_EVENTS, registerInboundEvents } from "../lib/socketEvents.js";

const ALICE = "507f1f77bcf86cd799439011";
const BOB = "507f1f77bcf86cd799439012";

/** Stands in for a Socket.IO socket: records handlers so tests can fire them. */
const makeSocket = () => {
  const handlers = new Map();
  return {
    on: (name, fn) => handlers.set(name, fn),
    fire: (name, payload) => handlers.get(name)?.(payload),
    names: () => [...handlers.keys()].sort((a, b) => a.localeCompare(b)),
  };
};

const makeContext = (emitted, overrides = {}) => ({
  userId: ALICE,
  getReceiverSocketIds: (id) => (id === BOB ? ["sock-b1", "sock-b2"] : []),
  io: {
    to: (socketId) => ({ emit: (event, payload) => emitted.push({ socketId, event, payload }) }),
  },
  ...overrides,
});

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
    registerInboundEvents(socket, makeContext([]));
    expect(socket.names()).toEqual(Object.keys(INBOUND_EVENTS).sort((a, b) => a.localeCompare(b)));
  });

  it("relays typing to every one of the recipient's sockets", () => {
    const emitted = [];
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted));

    socket.fire("typing", { toUserId: BOB });

    expect(emitted.map((e) => e.socketId)).toEqual(["sock-b1", "sock-b2"]);
    expect(emitted[0].event).toBe("userTyping");
  });

  it("relays stopTyping", () => {
    const emitted = [];
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted));

    socket.fire("stopTyping", { toUserId: BOB });
    expect(emitted[0].event).toBe("userStoppedTyping");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a non-id string", { toUserId: "not-an-id" }],
    ["a number", { toUserId: 42 }],
    ["a query operator", { toUserId: { $ne: null } }],
    ["an array", { toUserId: [BOB] }],
  ])("drops %s before it reaches a handler", (_label, payload) => {
    const emitted = [];
    // Asserting "nothing was emitted" is not enough: a handler that ran with a
    // null recipient also emits nothing, so the test would pass with validation
    // removed entirely. Assert the handler was never reached at all.
    const getReceiverSocketIds = vi.fn(() => []);
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted, { getReceiverSocketIds }));

    socket.fire("typing", payload);

    expect(getReceiverSocketIds).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("does reach the handler for a well-formed payload", () => {
    // guards the assertion above from passing for the wrong reason
    const getReceiverSocketIds = vi.fn(() => []);
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext([], { getReceiverSocketIds }));

    socket.fire("typing", { toUserId: BOB });
    expect(getReceiverSocketIds).toHaveBeenCalledWith(BOB);
  });

  it("takes the sender from the socket, never from the payload", () => {
    const emitted = [];
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted));

    socket.fire("typing", { toUserId: BOB, fromUserId: "attacker", userId: "attacker" });
    expect(emitted[0].payload).toEqual({ fromUserId: ALICE });
  });

  it("caps a flood at the burst allowance", () => {
    const emitted = [];
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted));

    for (let i = 0; i < 50; i += 1) socket.fire("typing", { toUserId: BOB });

    // two recipient sockets per accepted event
    expect(emitted.length / 2).toBe(INBOUND_EVENTS.typing.limit.capacity);
  });

  it("charges malformed payloads too, so a garbage flood is still bounded", () => {
    const emitted = [];
    const socket = makeSocket();
    registerInboundEvents(socket, makeContext(emitted));

    const { capacity } = INBOUND_EVENTS.typing.limit;
    for (let i = 0; i < capacity; i += 1) socket.fire("typing", { toUserId: "junk" });

    socket.fire("typing", { toUserId: BOB });
    expect(emitted).toEqual([]);
  });

  it("contains a throwing handler instead of dropping the connection", () => {
    const socket = makeSocket();
    registerInboundEvents(
      socket,
      makeContext([], {
        getReceiverSocketIds: () => {
          throw new Error("boom");
        },
      })
    );

    expect(() => socket.fire("typing", { toUserId: BOB })).not.toThrow();
  });
});
