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

const noop = () => {};
const asyncNoop = () => Promise.resolve();

beforeEach(() => {
  useAuthStore.setState({ authUser: ALICE, onlineUsers: [], socket: null });
  useChatStore.setState({
    allContacts: [],
    chats: [],
    messages: [],
    selectedUser: BOB,
    isUsersLoading: false,
    isMessagesLoading: false,
    isSoundEnabled: false,
    unreadCounts: {},
    receipts: {},
    typingUsers: {},
    // stub the actions that would otherwise reach the network
    getMyChatPartners: asyncNoop,
    getAllContacts: asyncNoop,
    getMessagesByUserId: asyncNoop,
    markConversationAsRead: asyncNoop,
    sendMessage: asyncNoop,
    emitTyping: noop,
    emitStopTyping: noop,
    setSelectedUser: noop,
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

    expect(sendMessage).toHaveBeenCalledWith({ text: "hello", image: null });
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
  it("renders the partner and their presence", () => {
    useAuthStore.setState({ onlineUsers: ["bob"] });
    render(<ChatHeader />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows typing in place of presence, and only for the open conversation", () => {
    useAuthStore.setState({ onlineUsers: ["bob"] });
    useChatStore.setState({ typingUsers: { bob: true } });
    render(<ChatHeader />);

    expect(screen.getByText("typing…")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });

  it("ignores someone else typing", () => {
    useChatStore.setState({ typingUsers: { carol: true } });
    render(<ChatHeader />);
    expect(screen.queryByText("typing…")).not.toBeInTheDocument();
  });
});

describe("ChatsList", () => {
  const chats = [
    { ...BOB, lastMessage: { text: "see you", createdAt: new Date().toISOString() } },
    { _id: "carol", name: "Carol", profilePic: "", lastMessage: { image: "x", text: "" } },
  ];

  it("renders conversations with previews", () => {
    useChatStore.setState({ chats });
    render(<ChatsList />);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("see you")).toBeInTheDocument();
    // an image-only message still needs a preview
    expect(screen.getByText("Photo")).toBeInTheDocument();
  });

  it("shows an unread badge only where there is something unread", () => {
    useChatStore.setState({ chats, unreadCounts: { bob: 3, carol: 0 } });
    render(<ChatsList />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/unread messages/)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("clamps a very large unread count", () => {
    useChatStore.setState({ chats, unreadCounts: { bob: 1234 } });
    render(<ChatsList />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});

describe("ChatContainer", () => {
  const own = (over = {}) => ({
    _id: "m1",
    senderId: "alice",
    receiverId: "bob",
    text: "mine",
    createdAt: new Date().toISOString(),
    ...over,
  });

  it("renders an empty conversation without crashing", () => {
    render(<ChatContainer />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it.each([
    ["sending", "Sending"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["read", "Read"],
  ])("labels a %s message for screen readers", (status, label) => {
    useChatStore.setState({ messages: [own({ status })] });
    render(<ChatContainer />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows no tick on a message written before receipts existed", () => {
    useChatStore.setState({ messages: [own({ status: undefined })] });
    render(<ChatContainer />);

    for (const label of ["Sending", "Sent", "Delivered", "Read"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("never shows a tick on someone else's message", () => {
    useChatStore.setState({
      messages: [own({ senderId: "bob", receiverId: "alice", status: "read" })],
    });
    render(<ChatContainer />);
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("marks the conversation read once the history has loaded", () => {
    const markConversationAsRead = vi.fn();
    useChatStore.setState({
      markConversationAsRead,
      messages: [own({ senderId: "bob", receiverId: "alice", status: "sent" })],
    });

    render(<ChatContainer />);
    expect(markConversationAsRead).toHaveBeenCalledWith("bob");
  });
});
