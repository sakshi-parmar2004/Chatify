import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/axios", () => ({
  axiosInstance: {
    patch: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: { messages: [], hasMore: false, nextCursor: null } }),
    post: vi.fn(),
  },
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const { useChatStore } = await import("../store/useChatStore");
const { useAuthStore } = await import("../store/useAuthStore");
const { axiosInstance } = await import("../lib/axios");

const ALICE = { _id: "alice", name: "Alice" };
const BOB = { _id: "bob", name: "Bob" };

const CONVERSATION = {
  _id: "conv1",
  type: "direct",
  participants: [ALICE, BOB],
  partner: BOB,
  unreadCount: 0,
  lastMessage: null,
};

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
  conversationId: "conv1",
  senderId: "bob",
  text: "hi",
  createdAt: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  socket = makeSocket();
  useAuthStore.setState({ authUser: ALICE, socket, onlineUsers: [] });
  useChatStore.setState({
    conversations: [{ ...CONVERSATION }],
    messages: [],
    selectedConversation: null,
    unreadCounts: {},
    cursors: {},
    typingUsers: {},
    isSoundEnabled: false,
    hasMoreMessages: false,
    oldestCursor: null,
    isLoadingOlder: false,
  });
  // The typing throttle is a module-scope timestamp, so it survives setState and
  // would leak a spent window into the next test. Selecting nothing resets it.
  useChatStore.getState().selectConversation(null);
  useChatStore.getState().subscribeToInbox();
});

describe("incoming messages", () => {
  it("badges a conversation that is not open", () => {
    socket.fire("newMessage", message());
    expect(useChatStore.getState().unreadCounts.conv1).toBe(1);

    socket.fire("newMessage", message());
    expect(useChatStore.getState().unreadCounts.conv1).toBe(2);
  });

  it("appends to the open conversation and marks it read instead of badging", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });

    socket.fire("newMessage", message({ _id: "m1" }));

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().unreadCounts.conv1).toBe(0);
    expect(axiosInstance.patch).toHaveBeenCalledWith("/conversations/conv1/read");
  });

  it("never badges or duplicates our own message echoed to another tab", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });
    const own = message({ _id: "mine", senderId: "alice" });

    socket.fire("newMessage", own);
    socket.fire("newMessage", own); // the same echo arriving twice

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().unreadCounts.conv1 ?? 0).toBe(0);
  });

  it("does not append a message belonging to another conversation", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });
    socket.fire("newMessage", message({ conversationId: "other" }));

    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("clears the sender's typing indicator", () => {
    socket.fire("userTyping", { conversationId: "conv1", userId: "bob" });
    expect(useChatStore.getState().typingUsers["conv1:bob"]).toBe(true);

    socket.fire("newMessage", message({ senderId: "bob" }));
    expect(useChatStore.getState().typingUsers["conv1:bob"]).toBeUndefined();
  });
});

describe("read cursors", () => {
  it("records another participant's read cursor", () => {
    const readAt = new Date(2026, 0, 1, 12, 5).toISOString();
    socket.fire("conversationRead", { conversationId: "conv1", userId: "bob", lastReadAt: readAt });

    expect(useChatStore.getState().cursors.conv1.bob.lastReadAt).toBe(readAt);
  });

  it("records a delivery cursor without clobbering the read cursor", () => {
    const readAt = new Date(2026, 0, 1, 12, 5).toISOString();
    const deliveredAt = new Date(2026, 0, 1, 12, 6).toISOString();

    socket.fire("conversationRead", { conversationId: "conv1", userId: "bob", lastReadAt: readAt });
    socket.fire("conversationDelivered", {
      conversationId: "conv1",
      userId: "bob",
      lastDeliveredAt: deliveredAt,
    });

    expect(useChatStore.getState().cursors.conv1.bob).toEqual({
      lastReadAt: readAt,
      lastDeliveredAt: deliveredAt,
    });
  });

  it("clears our own badge when another of our tabs reads the conversation", () => {
    useChatStore.setState({ unreadCounts: { conv1: 3 } });

    socket.fire("conversationRead", {
      conversationId: "conv1",
      userId: "alice",
      lastReadAt: new Date().toISOString(),
    });

    expect(useChatStore.getState().unreadCounts.conv1).toBe(0);
  });

  it("does not clear our badge when someone else reads", () => {
    useChatStore.setState({ unreadCounts: { conv1: 3 } });

    socket.fire("conversationRead", {
      conversationId: "conv1",
      userId: "bob",
      lastReadAt: new Date().toISOString(),
    });

    expect(useChatStore.getState().unreadCounts.conv1).toBe(3);
  });
});

describe("marking read", () => {
  it("clears the badge locally without waiting for the round trip", async () => {
    useChatStore.setState({ unreadCounts: { conv1: 4 } });

    const pending = useChatStore.getState().markConversationAsRead("conv1");
    expect(useChatStore.getState().unreadCounts.conv1).toBe(0);
    await pending;
  });

  it("stays off the wire when there is nothing unread", async () => {
    await useChatStore.getState().markConversationAsRead("conv1");
    expect(axiosInstance.patch).not.toHaveBeenCalled();
  });
});

describe("typing", () => {
  it("tracks and clears per conversation and per person", () => {
    socket.fire("userTyping", { conversationId: "conv1", userId: "bob" });
    expect(useChatStore.getState().typingUsers["conv1:bob"]).toBe(true);

    socket.fire("userStoppedTyping", { conversationId: "conv1", userId: "bob" });
    expect(useChatStore.getState().typingUsers["conv1:bob"]).toBeUndefined();
  });

  it("keeps the same person's typing separate across conversations", () => {
    socket.fire("userTyping", { conversationId: "conv1", userId: "bob" });
    socket.fire("userTyping", { conversationId: "conv2", userId: "bob" });
    socket.fire("userStoppedTyping", { conversationId: "conv1", userId: "bob" });

    expect(useChatStore.getState().typingUsers["conv1:bob"]).toBeUndefined();
    expect(useChatStore.getState().typingUsers["conv2:bob"]).toBe(true);
  });

  it("expires on its own, so a dropped connection cannot leave it stuck", () => {
    vi.useFakeTimers();
    try {
      socket.fire("userTyping", { conversationId: "conv1", userId: "bob" });
      expect(useChatStore.getState().typingUsers["conv1:bob"]).toBe(true);

      vi.advanceTimersByTime(6000);
      expect(useChatStore.getState().typingUsers["conv1:bob"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports only the open conversation's typists", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });

    socket.fire("userTyping", { conversationId: "conv1", userId: "bob" });
    socket.fire("userTyping", { conversationId: "conv2", userId: "carol" });

    expect(useChatStore.getState().typingInSelected()).toEqual(["bob"]);
  });

  it("throttles outgoing typing rather than emitting per keystroke", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });

    for (let i = 0; i < 20; i += 1) useChatStore.getState().emitTyping();

    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("typing", { conversationId: "conv1" });
  });

  it("lets the next keystroke through immediately after a stop", () => {
    useChatStore.setState({ selectedConversation: CONVERSATION });

    useChatStore.getState().emitTyping();
    useChatStore.getState().emitStopTyping();
    useChatStore.getState().emitTyping();

    const typingEmits = socket.emit.mock.calls.filter(([event]) => event === "typing");
    expect(typingEmits).toHaveLength(2);
  });

  it("lets the first keystroke through after switching conversation", () => {
    useChatStore.getState().selectConversation(CONVERSATION);
    useChatStore.getState().emitTyping();

    // the throttle window from one conversation must not swallow the next
    // conversation's first keystroke
    useChatStore.getState().selectConversation({ ...CONVERSATION, _id: "conv2" });
    useChatStore.getState().emitTyping();

    const typingEmits = socket.emit.mock.calls.filter(([event]) => event === "typing");
    expect(typingEmits.map(([, payload]) => payload.conversationId)).toEqual(["conv1", "conv2"]);
  });
});

describe("message updates", () => {
  it("replaces an edited message in place", () => {
    const original = message({ _id: "m1", text: "before" });
    useChatStore.setState({ selectedConversation: CONVERSATION, messages: [original] });

    socket.fire("messageUpdated", { ...original, text: "after", editedAt: new Date().toISOString() });

    expect(useChatStore.getState().messages[0].text).toBe("after");
  });
});

describe("removal from a conversation", () => {
  it("drops it from the list and closes it if open", () => {
    useChatStore.setState({
      selectedConversation: CONVERSATION,
      messages: [message()],
    });

    socket.fire("removedFromConversation", { conversationId: "conv1" });

    expect(useChatStore.getState().conversations).toEqual([]);
    expect(useChatStore.getState().selectedConversation).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
  });
});

describe("unsubscribeFromInbox", () => {
  it("stops responding to socket traffic", () => {
    useChatStore.getState().unsubscribeFromInbox();
    socket.fire("newMessage", message());

    expect(useChatStore.getState().unreadCounts.conv1).toBeUndefined();
  });
});
