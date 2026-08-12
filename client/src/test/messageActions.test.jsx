import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import MessageBubble from "../components/MessageBubble";
import MessageInput from "../components/MessageInput";

const ALICE = { _id: "alice", name: "Alice", profilePic: "" };
const BOB = { _id: "bob", name: "Bob", profilePic: "" };

const DIRECT = {
  _id: "conv1",
  type: "direct",
  participants: [ALICE, BOB],
  partner: BOB,
  admins: [],
};

const noop = () => {};
const asyncNoop = () => Promise.resolve();

const message = (over = {}) => ({
  _id: "m1",
  conversationId: "conv1",
  senderId: "alice",
  text: "hello",
  createdAt: new Date().toISOString(),
  reactions: [],
  ...over,
});

beforeEach(() => {
  useAuthStore.setState({ authUser: ALICE, onlineUsers: [], socket: null });
  useChatStore.setState({
    selectedConversation: DIRECT,
    messages: [],
    replyTarget: null,
    isSoundEnabled: false,
    setReplyTarget: noop,
    editMessage: noop,
    deleteMessage: noop,
    toggleReaction: noop,
    sendMessage: asyncNoop,
    emitTyping: noop,
    emitStopTyping: noop,
  });
});

const renderBubble = (over = {}) =>
  render(
    <MessageBubble
      message={message(over)}
      conversation={DIRECT}
      authUser={ALICE}
      receipt="sent"
    />
  );

describe("MSG-05 — reply", () => {
  it("sets the reply target from the bubble", async () => {
    const setReplyTarget = vi.fn();
    useChatStore.setState({ setReplyTarget });

    renderBubble();
    await userEvent.click(screen.getByLabelText("Reply"));

    expect(setReplyTarget).toHaveBeenCalledWith(expect.objectContaining({ _id: "m1" }));
  });

  it("shows the quote banner in the composer and can cancel it", async () => {
    const setReplyTarget = vi.fn();
    useChatStore.setState({ replyTarget: message({ text: "the original" }), setReplyTarget });

    render(<MessageInput />);
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getByText("the original")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Cancel reply"));
    expect(setReplyTarget).toHaveBeenCalledWith(null);
  });

  it("sends replyTo when a quote is active", async () => {
    const sendMessage = vi.fn();
    useChatStore.setState({ replyTarget: message({ _id: "parent" }), sendMessage });

    render(<MessageInput />);
    await userEvent.type(screen.getByPlaceholderText("Type your message..."), "agreed{Enter}");

    expect(sendMessage).toHaveBeenCalledWith({
      text: "agreed",
      image: null,
      replyTo: "parent",
    });
  });

  it("renders a quoted snapshot, and marks a deleted parent", () => {
    const { unmount } = renderBubble({ replySnapshot: { text: "quoted", hasImage: false } });
    expect(screen.getByText("quoted")).toBeInTheDocument();
    unmount();

    renderBubble({ replySnapshot: { deleted: true, text: "" } });
    expect(screen.getByText("Deleted message")).toBeInTheDocument();
  });
});

describe("MSG-04 — edit and delete", () => {
  it("edits in place and submits the new text", async () => {
    const editMessage = vi.fn();
    useChatStore.setState({ editMessage });

    renderBubble({ text: "teh typo" });
    await userEvent.click(screen.getByLabelText("Edit message"));

    const input = screen.getByLabelText("Edit message");
    await userEvent.clear(input);
    await userEvent.type(input, "the typo{Enter}");

    expect(editMessage).toHaveBeenCalledWith("m1", "the typo");
  });

  it("does not submit an unchanged edit", async () => {
    const editMessage = vi.fn();
    useChatStore.setState({ editMessage });

    renderBubble({ text: "same" });
    await userEvent.click(screen.getByLabelText("Edit message"));
    await userEvent.type(screen.getByLabelText("Edit message"), "{Enter}");

    expect(editMessage).not.toHaveBeenCalled();
  });

  it("offers no edit or delete on someone else's message", () => {
    renderBubble({ senderId: "bob" });

    expect(screen.queryByLabelText("Edit message")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete message")).not.toBeInTheDocument();
  });

  it("hides edit and delete once the window has passed", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    renderBubble({ createdAt: twoHoursAgo });

    expect(screen.queryByLabelText("Edit message")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete message")).not.toBeInTheDocument();
  });

  it("lets a group admin delete someone else's message", () => {
    const group = {
      ...DIRECT,
      _id: "conv2",
      type: "group",
      name: "Group",
      admins: ["alice"],
    };

    render(
      <MessageBubble
        message={message({ senderId: "bob", conversationId: "conv2" })}
        conversation={group}
        authUser={ALICE}
        receipt={null}
      />
    );

    expect(screen.getByLabelText("Delete message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit message")).not.toBeInTheDocument();
  });

  it("renders a tombstone with no actions", () => {
    renderBubble({ deletedAt: new Date().toISOString(), text: "" });

    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument();
  });
});

describe("MSG-06 — reactions", () => {
  it("adds a reaction from the quick picker", async () => {
    const toggleReaction = vi.fn();
    useChatStore.setState({ toggleReaction });

    renderBubble();
    await userEvent.click(screen.getByLabelText("Add reaction"));
    await userEvent.click(screen.getByLabelText("React with 👍"));

    expect(toggleReaction).toHaveBeenCalledWith("m1", "👍");
  });

  it("groups identical emoji into one chip with a count", () => {
    renderBubble({
      reactions: [
        { emoji: "👍", userId: "alice" },
        { emoji: "👍", userId: "bob" },
        { emoji: "🎉", userId: "bob" },
      ],
    });

    expect(screen.getByText("👍 2")).toBeInTheDocument();
    expect(screen.getByText("🎉 1")).toBeInTheDocument();
  });

  it("marks your own reaction and toggles it off when clicked", async () => {
    const toggleReaction = vi.fn();
    useChatStore.setState({ toggleReaction });

    renderBubble({ reactions: [{ emoji: "👍", userId: "alice" }] });

    const chip = screen.getByLabelText(/including you/);
    await userEvent.click(chip);

    expect(toggleReaction).toHaveBeenCalledWith("m1", "👍");
  });
});

describe("attachments", () => {
  it.each([
    ["image", "img"],
    ["video", "video"],
    ["audio", "audio"],
  ])("renders a %s attachment", (kind, tag) => {
    const { container } = renderBubble({
      text: "",
      attachment: { kind, url: `https://cdn.test/a.${kind}`, publicId: "p", name: "a", bytes: 10 },
    });

    expect(container.querySelector(tag)).toBeTruthy();
  });

  it("renders an arbitrary file as a download link with its size", () => {
    renderBubble({
      text: "",
      attachment: {
        kind: "file",
        url: "https://cdn.test/report.pdf",
        publicId: "p",
        name: "report.pdf",
        bytes: 2048,
      },
    });

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });
});

describe("MSG-09 — link previews", () => {
  it("renders a preview card when one has been resolved", () => {
    renderBubble({
      text: "look at this",
      linkPreview: {
        url: "https://example.com",
        title: "Example Domain",
        description: "An example",
        image: "",
      },
    });

    expect(screen.getByText("Example Domain")).toBeInTheDocument();
  });
});
