import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/axios", () => ({
  axiosInstance: {
    patch: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: { messages: [], hasMore: false, nextCursor: null } }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const { useChatStore } = await import("../store/useChatStore");
const { useAuthStore } = await import("../store/useAuthStore");

const ALICE = { _id: "alice", name: "Alice" };
const CONVERSATION = { _id: "conv1", type: "direct", participants: [ALICE], partner: null };

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
let notificationSpy;

beforeEach(() => {
  vi.clearAllMocks();
  socket = makeSocket();

  // a plain arrow function is not constructible, and both of these are used
  // with `new`
  notificationSpy = vi.fn();
  function FakeNotification(title, options) {
    notificationSpy(title, options);
  }
  FakeNotification.permission = "granted";
  globalThis.Notification = FakeNotification;

  useAuthStore.setState({ authUser: ALICE, socket, onlineUsers: [] });
  useChatStore.setState({
    conversations: [CONVERSATION],
    messages: [],
    selectedConversation: null,
    unreadCounts: {},
    cursors: {},
    typingUsers: {},
    isSoundEnabled: false,
  });
  useChatStore.getState().selectConversation(null);
  useChatStore.getState().subscribeToInbox();
  useAuthStore.getState().subscribeToPresence();
});

afterEach(() => {
  delete globalThis.Notification;
});

describe("NTF-02 — desktop notifications", () => {
  const payload = { conversationId: "conv1", title: "Alice", body: "hello" };

  it("notifies when the tab is hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    useChatStore.setState({ selectedConversation: CONVERSATION });

    socket.fire("notify", payload);

    expect(notificationSpy).toHaveBeenCalledWith(
      "Alice",
      expect.objectContaining({ body: "hello", tag: "conv1" })
    );
  });

  it("notifies when the conversation is not the open one", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    useChatStore.setState({ selectedConversation: { ...CONVERSATION, _id: "other" } });

    socket.fire("notify", payload);
    expect(notificationSpy).toHaveBeenCalled();
  });

  it("stays silent when the user is already looking at the conversation", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    useChatStore.setState({ selectedConversation: CONVERSATION });

    socket.fire("notify", payload);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it("stays silent when permission has not been granted", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    globalThis.Notification.permission = "default";

    socket.fire("notify", payload);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the browser blocks constructing one", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    function ThrowingNotification() {
      throw new Error("Illegal constructor");
    }
    ThrowingNotification.permission = "granted";
    globalThis.Notification = ThrowingNotification;

    expect(() => socket.fire("notify", payload)).not.toThrow();
  });
});

describe("PLT-05 — scoped presence", () => {
  it("takes the initial roster from the server", () => {
    socket.fire("getOnlineUsers", ["bob", "carol"]);
    expect(useAuthStore.getState().onlineUsers).toEqual(["bob", "carol"]);
  });

  it("adds a contact who comes online", () => {
    socket.fire("presence", { userId: "bob", online: true });
    expect(useAuthStore.getState().onlineUsers).toContain("bob");
  });

  it("removes one who goes offline", () => {
    useAuthStore.setState({ onlineUsers: ["bob", "carol"] });
    socket.fire("presence", { userId: "bob", online: false });

    expect(useAuthStore.getState().onlineUsers).toEqual(["carol"]);
  });

  it("does not duplicate a contact who reconnects", () => {
    socket.fire("presence", { userId: "bob", online: true });
    socket.fire("presence", { userId: "bob", online: true });

    expect(useAuthStore.getState().onlineUsers).toEqual(["bob"]);
  });
});

describe("NTF-04 — muted conversations stay quiet", () => {
  const message = () => ({
    _id: "m1",
    conversationId: "conv1",
    senderId: "bob",
    text: "hi",
    createdAt: new Date().toISOString(),
  });

  it("plays no sound for a muted conversation", () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    globalThis.Audio = class {
      play() {
        return playSpy();
      }
    };

    useChatStore.setState({
      isSoundEnabled: true,
      conversations: [
        { ...CONVERSATION, mutedUntil: new Date(Date.now() + 60_000).toISOString() },
      ],
    });

    socket.fire("newMessage", message());
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("still plays for an unmuted one", () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    globalThis.Audio = class {
      play() {
        return playSpy();
      }
    };

    useChatStore.setState({ isSoundEnabled: true, conversations: [CONVERSATION] });

    socket.fire("newMessage", message());
    expect(playSpy).toHaveBeenCalled();
  });

  it("plays again once the mute has expired", () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    globalThis.Audio = class {
      play() {
        return playSpy();
      }
    };

    useChatStore.setState({
      isSoundEnabled: true,
      conversations: [
        { ...CONVERSATION, mutedUntil: new Date(Date.now() - 60_000).toISOString() },
      ],
    });

    socket.fire("newMessage", message());
    expect(playSpy).toHaveBeenCalled();
  });
});
