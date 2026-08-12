import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import NewGroupDialog from "../components/NewGroupDialog";
import GroupDetailsPanel from "../components/GroupDetailsPanel";
import ChatHeader from "../components/ChatHeader";

const ALICE = { _id: "alice", name: "Alice", profilePic: "" };
const BOB = { _id: "bob", name: "Bob", profilePic: "" };
const CAROL = { _id: "carol", name: "Carol", profilePic: "" };
const DAVE = { _id: "dave", name: "Dave", profilePic: "" };

const group = (over = {}) => ({
  _id: "conv2",
  type: "group",
  name: "Weekend plans",
  participants: [ALICE, BOB, CAROL],
  admins: ["alice"],
  partner: null,
  ...over,
});

const noop = () => {};
const asyncNoop = () => Promise.resolve();

beforeEach(() => {
  useAuthStore.setState({ authUser: ALICE, onlineUsers: [], socket: null });
  useChatStore.setState({
    allContacts: [BOB, CAROL, DAVE],
    conversations: [],
    selectedConversation: group(),
    typingUsers: {},
    getAllContacts: asyncNoop,
    getConversationMedia: () => Promise.resolve({ items: [], hasMore: false }),
    createGroup: asyncNoop,
    renameGroup: noop,
    addParticipants: noop,
    removeParticipant: noop,
    setAdmin: noop,
    selectConversation: noop,
    closeConversation: noop,
    typingInSelected: () => [],
  });
});

describe("GRP-01 — new group dialog", () => {
  it("requires a name and at least one member", async () => {
    render(<NewGroupDialog onClose={noop} />);

    const submit = screen.getByRole("button", { name: /create group/i });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Group name"), "Trip");
    expect(submit).toBeDisabled(); // name alone is not enough

    await userEvent.click(screen.getByRole("checkbox", { name: /bob/i }));
    expect(submit).toBeEnabled();
  });

  it("creates the group with the selected members", async () => {
    const createGroup = vi.fn().mockResolvedValue(group());
    useChatStore.setState({ createGroup });

    render(<NewGroupDialog onClose={noop} />);
    await userEvent.type(screen.getByLabelText("Group name"), "Trip");
    await userEvent.click(screen.getByRole("checkbox", { name: /bob/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /carol/i }));
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));

    expect(createGroup).toHaveBeenCalledWith({
      name: "Trip",
      participantIds: ["bob", "carol"],
    });
  });

  it("closes only after a successful create", async () => {
    const onClose = vi.fn();
    useChatStore.setState({ createGroup: vi.fn().mockResolvedValue(null) });

    render(<NewGroupDialog onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Group name"), "Trip");
    await userEvent.click(screen.getByRole("checkbox", { name: /bob/i }));
    await userEvent.click(screen.getByRole("button", { name: /create group/i }));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("GRP-02 — admin controls", () => {
  it("shows admin controls to an admin", () => {
    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);

    expect(screen.getByLabelText("Group name")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Bob")).toBeInTheDocument();
    expect(screen.getByLabelText("Promote Bob")).toBeInTheDocument();
  });

  it("hides them from a member", () => {
    useAuthStore.setState({ authUser: BOB });
    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);

    expect(screen.queryByLabelText("Group name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Carol")).not.toBeInTheDocument();
    // the name is still readable, just not editable
    expect(screen.getByText("Weekend plans")).toBeInTheDocument();
  });

  it("never offers to remove or demote yourself from the member list", () => {
    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);

    expect(screen.queryByLabelText("Remove Alice")).not.toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("marks who is an admin", () => {
    render(<GroupDetailsPanel conversation={group({ admins: ["alice", "bob"] })} onClose={noop} />);
    expect(screen.getAllByText("Admin")).toHaveLength(2);
  });

  it("renames on submit", async () => {
    const renameGroup = vi.fn();
    useChatStore.setState({ renameGroup });

    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    const input = screen.getByLabelText("Group name");
    await userEvent.clear(input);
    await userEvent.type(input, "New name{Enter}");

    expect(renameGroup).toHaveBeenCalledWith("conv2", "New name");
  });

  it("promotes a member", async () => {
    const setAdmin = vi.fn();
    useChatStore.setState({ setAdmin });

    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    await userEvent.click(screen.getByLabelText("Promote Bob"));

    expect(setAdmin).toHaveBeenCalledWith("conv2", "bob", true);
  });

  it("demotes an existing admin", async () => {
    const setAdmin = vi.fn();
    useChatStore.setState({ setAdmin });

    render(<GroupDetailsPanel conversation={group({ admins: ["alice", "bob"] })} onClose={noop} />);
    await userEvent.click(screen.getByLabelText("Demote Bob"));

    expect(setAdmin).toHaveBeenCalledWith("conv2", "bob", false);
  });
});

describe("GRP-03 — membership", () => {
  it("offers only people who are not already members", async () => {
    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /add people/i }));

    // Dave is the only contact not in the group
    expect(screen.getByRole("button", { name: "Dave" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bob" })).not.toBeInTheDocument();
  });

  it("adds a member", async () => {
    const addParticipants = vi.fn();
    useChatStore.setState({ addParticipants });

    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /add people/i }));
    await userEvent.click(screen.getByRole("button", { name: "Dave" }));

    expect(addParticipants).toHaveBeenCalledWith("conv2", ["dave"]);
  });

  it("removes a member", async () => {
    const removeParticipant = vi.fn();
    useChatStore.setState({ removeParticipant });

    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    await userEvent.click(screen.getByLabelText("Remove Bob"));

    expect(removeParticipant).toHaveBeenCalledWith("conv2", "bob");
  });

  it("leaves the group", async () => {
    const removeParticipant = vi.fn();
    const onClose = vi.fn();
    useChatStore.setState({ removeParticipant });

    render(<GroupDetailsPanel conversation={group()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /leave group/i }));

    expect(removeParticipant).toHaveBeenCalledWith("conv2", "alice");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MED-07 — shared media", () => {
  it("says so when nothing has been shared", async () => {
    render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    expect(await screen.findByText("Nothing shared yet.")).toBeInTheDocument();
  });

  it("renders shared images", async () => {
    useChatStore.setState({
      getConversationMedia: () =>
        Promise.resolve({
          items: [
            {
              _id: "m1",
              attachment: { kind: "image", url: "https://cdn.test/a.png", name: "a.png" },
            },
          ],
          hasMore: false,
        }),
    });

    const { container } = render(<GroupDetailsPanel conversation={group()} onClose={noop} />);
    expect(await screen.findByText(/shared media/i)).toBeInTheDocument();
    await vi.waitFor(() => expect(container.querySelector("a img")).toBeTruthy());
  });
});

describe("ChatHeader group affordance", () => {
  it("offers group details only for a group", () => {
    const { unmount } = render(<ChatHeader />);
    expect(screen.getByLabelText("Group details")).toBeInTheDocument();
    unmount();

    useChatStore.setState({
      selectedConversation: { _id: "conv1", type: "direct", participants: [ALICE, BOB], partner: BOB },
    });
    render(<ChatHeader />);
    expect(screen.queryByLabelText("Group details")).not.toBeInTheDocument();
  });
});
