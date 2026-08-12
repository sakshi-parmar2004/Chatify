import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import MessageInput from "../components/MessageInput";
import ChatHeader from "../components/ChatHeader";
import ChatsList from "../components/ChatsList";
import ChatContainer from "../components/ChatContainer";

// These are render smoke tests before they are anything else. A component that
// references a store value before it is destructured throws at render with a
// temporal-dead-zone error that neither the build nor oxlint can see — the
// build does not evaluate the module, and no-use-before-define is not
// implemented in this oxlint version. Rendering is the only thing that catches
// it, which is why every component that reads from a store has an entry here.

const ALICE = { _id: "alice", name: "Alice", profilePic: "" };
const BOB = { _id: "bob", name: "Bob", profilePic: "" };
const CAROL = { _id: "carol", name: "Carol", profilePic: "" };

const DIRECT = {
  _id: "conv1",
  type: "direct",
  participants: [ALICE, BOB],
  partner: BOB,
  lastMessage: { text: "see you", createdAt: new Date().toISOString() },
};

const GROUP = {
  _id: "conv2",
  type: "group",
  name: "Weekend plans",
  participants: [ALICE, BOB, CAROL],
  partner: null,
  lastMessage: null,
};

const noop = () => {};
const asyncNoop = () => Promise.resolve();

beforeEach(() => {
  useAuthStore.setState({ authUser: ALICE, onlineUsers: [], socket: null });
  useChatStore.setState({
    allContacts: [],
    conversations: [],
    messages: [],
    selectedConversation: DIRECT,
    isUsersLoading: false,
    isMessagesLoading: false,
    isLoadingOlder: false,
    hasMoreMessages: false,
    oldestCursor: null,
    isSoundEnabled: false,
    unreadCounts: {},
    cursors: {},
    typingUsers: {},
    getConversations: asyncNoop,
    getAllContacts: asyncNoop,
    getMessages: asyncNoop,
    loadOlderMessages: asyncNoop,
    markConversationAsRead: asyncNoop,
    sendMessage: asyncNoop,
    openDirectConversation: asyncNoop,
    selectConversation: noop,
    closeConversation: noop,
    emitTyping: noop,
    emitStopTyping: noop,
  });
});

describe("MessageInput", () => {
  it("renders", () => {
    render(<MessageInput />);
    expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument();
  });

  it("signals typing while composing and stops when the box is cleared", async () => {
    const emitTyping = vi.fn();
    const emitStopTyping = vi.fn();
    useChatStore.setState({ emitTyping, emitStopTyping });

    render(<MessageInput />);
    const input = screen.getByPlaceholderText("Type your message...");

    await userEvent.type(input, "hi");
    expect(emitTyping).toHaveBeenCalled();

    await userEvent.clear(input);
    // clearing the box is a deliberate "never mind", not a pause
    expect(emitStopTyping).toHaveBeenCalled();
  });

  it("stops typing and sends on submit", async () => {
    const sendMessage = vi.fn();
    const emitStopTyping = vi.fn();
    useChatStore.setState({ sendMessage, emitStopTyping });

    render(<MessageInput />);
    await userEvent.type(screen.getByPlaceholderText("Type your message..."), "hello{Enter}");

    // image is gone from the send payload: attachments replaced the base64 path
    expect(sendMessage).toHaveBeenCalledWith({ text: "hello" });
    expect(emitStopTyping).toHaveBeenCalled();
  });

  it("stops typing when it unmounts mid-sentence", () => {
    const emitStopTyping = vi.fn();
    useChatStore.setState({ emitStopTyping });

    const { unmount } = render(<MessageInput />);
    unmount();

    expect(emitStopTyping).toHaveBeenCalled();
  });

  it("will not send an empty message", async () => {
    const sendMessage = vi.fn();
    useChatStore.setState({ sendMessage });

    render(<MessageInput />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("ChatHeader", () => {
  it("renders the partner and their presence for a direct chat", () => {
    useAuthStore.setState({ onlineUsers: ["bob"] });
    render(<ChatHeader />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("renders a group name and member count", () => {
    useChatStore.setState({ selectedConversation: GROUP });
    render(<ChatHeader />);

    expect(screen.getByText("Weekend plans")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
  });

  it("shows typing in place of presence", () => {
    useAuthStore.setState({ onlineUsers: ["bob"] });
    useChatStore.setState({ typingUsers: { "conv1:bob": true } });
    render(<ChatHeader />);

    expect(screen.getByText("typing…")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });

  it("names who is typing in a group", () => {
    useChatStore.setState({
      selectedConversation: GROUP,
      typingUsers: { "conv2:carol": true },
    });
    render(<ChatHeader />);

    expect(screen.getByText("Carol is typing…")).toBeInTheDocument();
  });

  it("ignores typing from another conversation", () => {
    useChatStore.setState({ typingUsers: { "conv9:bob": true } });
    render(<ChatHeader />);
    expect(screen.queryByText("typing…")).not.toBeInTheDocument();
  });
});

describe("ChatsList", () => {
  const conversations = [
    DIRECT,
    {
      _id: "conv3",
      type: "direct",
      participants: [ALICE, CAROL],
      partner: CAROL,
      lastMessage: { image: "x", text: "" },
    },
    GROUP,
  ];

  it("renders conversations with previews", () => {
    useChatStore.setState({ conversations });
    render(<ChatsList />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("see you")).toBeInTheDocument();
    // an image-only message still needs a preview
    expect(screen.getByText("Photo")).toBeInTheDocument();
    expect(screen.getByText("Weekend plans")).toBeInTheDocument();
  });

  it("shows a tombstoned last message as deleted", () => {
    useChatStore.setState({
      conversations: [{ ...DIRECT, lastMessage: { text: "gone", deletedAt: new Date().toISOString() } }],
    });
    render(<ChatsList />);
    expect(screen.getByText("Message deleted")).toBeInTheDocument();
  });

  it("shows an unread badge only where there is something unread", () => {
    useChatStore.setState({ conversations, unreadCounts: { conv1: 3, conv3: 0 } });
    render(<ChatsList />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/unread messages/)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("clamps a very large unread count", () => {
    useChatStore.setState({ conversations, unreadCounts: { conv1: 1234 } });
    render(<ChatsList />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});

describe("ChatContainer", () => {
  const own = (over = {}) => ({
    _id: "m1",
    conversationId: "conv1",
    senderId: "alice",
    text: "mine",
    createdAt: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
    ...over,
  });

  const cursorsWhere = (field, at) => ({
    conv1: { bob: { [field]: at } },
  });

  it("renders an empty conversation without crashing", () => {
    render(<ChatContainer />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows a single tick when nobody has received it yet", () => {
    useChatStore.setState({ messages: [own()] });
    render(<ChatContainer />);
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("shows delivered once the partner's delivery cursor passes it", () => {
    useChatStore.setState({
      messages: [own()],
      cursors: cursorsWhere("lastDeliveredAt", new Date(2026, 0, 1, 12, 5).toISOString()),
    });
    render(<ChatContainer />);
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("shows read once the partner's read cursor passes it", () => {
    useChatStore.setState({
      messages: [own()],
      cursors: cursorsWhere("lastReadAt", new Date(2026, 0, 1, 12, 5).toISOString()),
    });
    render(<ChatContainer />);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("does not mark a newer message read from an older cursor", () => {
    useChatStore.setState({
      messages: [own({ createdAt: new Date(2026, 0, 1, 13, 0).toISOString() })],
      cursors: cursorsWhere("lastReadAt", new Date(2026, 0, 1, 12, 5).toISOString()),
    });
    render(<ChatContainer />);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("shows sending for an optimistic message", () => {
    useChatStore.setState({ messages: [own({ isOptimistic: true })] });
    render(<ChatContainer />);
    expect(screen.getByText("Sending")).toBeInTheDocument();
  });

  it("never shows a tick on someone else's message", () => {
    useChatStore.setState({
      messages: [own({ senderId: "bob" })],
      cursors: cursorsWhere("lastReadAt", new Date(2026, 0, 1, 12, 5).toISOString()),
    });
    render(<ChatContainer />);
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("only calls a group message read when every member has read it", () => {
    const readAt = new Date(2026, 0, 1, 12, 5).toISOString();
    useChatStore.setState({
      selectedConversation: GROUP,
      messages: [own({ conversationId: "conv2" })],
      // bob has read it, carol has not
      cursors: { conv2: { bob: { lastReadAt: readAt } } },
    });
    render(<ChatContainer />);

    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("renders a tombstone instead of deleted content", () => {
    useChatStore.setState({
      messages: [own({ text: "secret", deletedAt: new Date().toISOString() })],
    });
    render(<ChatContainer />);

    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("marks an edited message as edited", () => {
    useChatStore.setState({ messages: [own({ editedAt: new Date().toISOString() })] });
    render(<ChatContainer />);
    expect(screen.getByText("· edited")).toBeInTheDocument();
  });

  it("renders a quoted reply", () => {
    useChatStore.setState({
      messages: [own({ replySnapshot: { text: "the original", hasImage: false } })],
    });
    render(<ChatContainer />);
    expect(screen.getByText("the original")).toBeInTheDocument();
  });

  it("names the sender in a group but not in a direct chat", () => {
    useChatStore.setState({
      selectedConversation: GROUP,
      messages: [own({ conversationId: "conv2", senderId: "carol" })],
    });
    const { unmount } = render(<ChatContainer />);
    expect(screen.getByText("Carol")).toBeInTheDocument();
    unmount();

    useChatStore.setState({ selectedConversation: DIRECT, messages: [own({ senderId: "bob" })] });
    render(<ChatContainer />);
    // the header still says Bob, but the bubble must not repeat it
    expect(screen.getAllByText("Bob")).toHaveLength(1);
  });

  it("says when the beginning of the conversation has been reached", () => {
    useChatStore.setState({ messages: [own()], hasMoreMessages: false });
    render(<ChatContainer />);
    expect(screen.getByText("This is the beginning of the conversation")).toBeInTheDocument();
  });

  it("marks the conversation read once the history has loaded", () => {
    const markConversationAsRead = vi.fn();
    useChatStore.setState({ markConversationAsRead, messages: [own({ senderId: "bob" })] });

    render(<ChatContainer />);
    expect(markConversationAsRead).toHaveBeenCalledWith("conv1");
  });
});
