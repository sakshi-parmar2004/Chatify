import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/axios", () => ({
  axiosInstance: { patch: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn(), post: vi.fn() },
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const { useChatStore } = await import("../store/useChatStore");
const { useAuthStore } = await import("../store/useAuthStore");
const { axiosInstance } = await import("../lib/axios");

const ALICE = { _id: "alice", name: "Alice" };
const BOB = { _id: "bob", name: "Bob" };

/** Records handlers the way socket.io would, so tests can drive them. */
const makeSocket = () => {
  const handlers = new Map();
  return {
    on: (name, fn) => handlers.set(name, fn),
    off: (name) => handlers.delete(name),
    emit: vi.fn(),
    fire: (name, payload) => handlers.get(name)?.(payload),
  };
};

let socket;

const message = (over = {}) => ({
  _id: `m-${Math.random()}`,
  senderId: "bob",
  receiverId: "alice",
  text: "hi",
  status: "delivered",
  createdAt: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  socket = makeSocket();
  useAuthStore.setState({ authUser: ALICE, socket, onlineUsers: [] });
  useChatStore.setState({
    chats: [{ ...BOB }],
    messages: [],
    selectedUser: null,
    unreadCounts: {},
    receipts: {},
    typingUsers: {},
    isSoundEnabled: false,
  });
  useChatStore.getState().subscribeToInbox();
});

describe("incoming messages", () => {
  it("badges a conversation that is not open", () => {
    socket.fire("newMessage", message());
    expect(useChatStore.getState().unreadCounts.bob).toBe(1);

    socket.fire("newMessage", message());
    expect(useChatStore.getState().unreadCounts.bob).toBe(2);
  });

  it("appends to the open conversation and marks it read instead of badging", () => {
    useChatStore.setState({ selectedUser: BOB });

    socket.fire("newMessage", message({ _id: "m1" }));

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().unreadCounts.bob ?? 0).toBe(0);
    expect(axiosInstance.patch).toHaveBeenCalledWith("/messages/read/bob");
  });

  it("never badges or duplicates our own message echoed to another tab", () => {
    useChatStore.setState({ selectedUser: BOB });
    const own = message({ _id: "mine", senderId: "alice", receiverId: "bob" });

    socket.fire("newMessage", own);
    socket.fire("newMessage", own); // the same echo arriving twice

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().unreadCounts.bob ?? 0).toBe(0);
  });

  it("does not append a message belonging to another conversation", () => {
    useChatStore.setState({ selectedUser: BOB });
    socket.fire("newMessage", message({ senderId: "carol" }));

    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().unreadCounts.carol).toBe(1);
  });
});

describe("receipt watermarks", () => {
  const own = (over = {}) =>
    message({ senderId: "alice", receiverId: "bob", status: "sent", ...over });

  it("flips our sent messages to read", () => {
    useChatStore.setState({ messages: [own({ _id: "m1" })] });

    socket.fire("messagesRead", {
      partnerId: "bob",
      readAt: new Date(2026, 0, 1, 12, 0, 5).toISOString(),
    });

    expect(useChatStore.getState().messages[0].status).toBe("read");
  });

  it("leaves a message newer than the watermark alone", () => {
    useChatStore.setState({
      messages: [own({ _id: "m1", createdAt: new Date(2026, 0, 1, 13, 0, 0).toISOString() })],
    });

    socket.fire("messagesRead", {
      partnerId: "bob",
      readAt: new Date(2026, 0, 1, 12, 0, 5).toISOString(),
    });

    expect(useChatStore.getState().messages[0].status).toBe("sent");
  });

  it("applies a receipt that arrived before its message — the race it exists for", () => {
    // receipt first, with no messages in state at all
    socket.fire("messagesRead", {
      partnerId: "bob",
      readAt: new Date(2026, 0, 1, 12, 0, 5).toISOString(),
    });

    useChatStore.setState({ selectedUser: BOB });
    socket.fire("newMessage", own({ _id: "late" }));

    expect(useChatStore.getState().messages[0].status).toBe("read");
  });

  it("never downgrades read to delivered", () => {
    useChatStore.setState({ messages: [own({ _id: "m1", status: "read" })] });

    socket.fire("messagesDelivered", {
      partnerId: "bob",
      deliveredAt: new Date(2026, 0, 1, 12, 0, 5).toISOString(),
    });

    expect(useChatStore.getState().messages[0].status).toBe("read");
  });

  it("ignores a receipt for a different conversation", () => {
    useChatStore.setState({ messages: [own({ _id: "m1" })] });

    socket.fire("messagesRead", {
      partnerId: "carol",
      readAt: new Date(2026, 0, 1, 12, 0, 5).toISOString(),
    });

    expect(useChatStore.getState().messages[0].status).toBe("sent");
  });
});

describe("marking read", () => {
  it("clears the badge locally without waiting for the round trip", async () => {
    useChatStore.setState({ unreadCounts: { bob: 4 } });

    const pending = useChatStore.getState().markConversationAsRead("bob");
    expect(useChatStore.getState().unreadCounts.bob).toBe(0);
    await pending;
  });

  it("stays off the wire when there is nothing unread", async () => {
    await useChatStore.getState().markConversationAsRead("bob");
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });

  it("clears every tab's badge when another tab reads the conversation", () => {
    useChatStore.setState({
      unreadCounts: { bob: 3 },
      messages: [message({ _id: "m1", status: "delivered" })],
    });

    socket.fire("conversationRead", { partnerId: "bob" });

    expect(useChatStore.getState().unreadCounts.bob).toBe(0);
    expect(useChatStore.getState().messages[0].status).toBe("read");
  });
});

describe("typing", () => {
  it("tracks and clears a partner who is composing", () => {
    socket.fire("userTyping", { fromUserId: "bob" });
    expect(useChatStore.getState().typingUsers.bob).toBe(true);

    socket.fire("userStoppedTyping", { fromUserId: "bob" });
    expect(useChatStore.getState().typingUsers.bob).toBeUndefined();
  });

  it("expires on its own, so a dropped connection cannot leave it stuck", () => {
    vi.useFakeTimers();
    try {
      socket.fire("userTyping", { fromUserId: "bob" });
      expect(useChatStore.getState().typingUsers.bob).toBe(true);

      vi.advanceTimersByTime(6000);
      expect(useChatStore.getState().typingUsers.bob).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttles outgoing typing rather than emitting per keystroke", () => {
    useChatStore.getState().setSelectedUser(BOB);

    for (let i = 0; i < 20; i += 1) useChatStore.getState().emitTyping();

    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("typing", { toUserId: "bob" });
  });

  it("lets the next keystroke through immediately after a stop", () => {
    useChatStore.getState().setSelectedUser(BOB);

    useChatStore.getState().emitTyping();
    useChatStore.getState().emitStopTyping();
    useChatStore.getState().emitTyping();

    const typingEmits = socket.emit.mock.calls.filter(([event]) => event === "typing");
    expect(typingEmits).toHaveLength(2);
  });

  it("lets the first keystroke through after switching conversation", () => {
    useChatStore.getState().setSelectedUser(BOB);
    useChatStore.getState().emitTyping();

    // the throttle window from Bob's conversation must not swallow Carol's
    // first keystroke
    useChatStore.getState().setSelectedUser({ _id: "carol", name: "Carol" });
    useChatStore.getState().emitTyping();

    const typingEmits = socket.emit.mock.calls.filter(([event]) => event === "typing");
    expect(typingEmits.map(([, payload]) => payload.toUserId)).toEqual(["bob", "carol"]);
  });
});

describe("unsubscribeFromInbox", () => {
  it("stops responding to socket traffic", () => {
    useChatStore.getState().unsubscribeFromInbox();
    socket.fire("newMessage", message());

    expect(useChatStore.getState().unreadCounts.bob).toBeUndefined();
  });
});
