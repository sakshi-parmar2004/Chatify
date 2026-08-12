import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import toast from "react-hot-toast";
import { useAuthStore } from "./useAuthStore";

const errorMessage = (error, fallback = "Something went wrong") =>
  error?.response?.data?.message || fallback;

// Typing indicators are ephemeral, so their timers live at module scope rather
// than in the store — nothing renders off them and keeping them out of state
// avoids a re-render per keystroke.
const TYPING_THROTTLE_MS = 2000;
// Longer than the throttle, so a steady typist never flickers, but short enough
// that a dropped connection clears within a beat.
const TYPING_EXPIRY_MS = 5000;

let lastTypingEmit = 0;
const typingTimers = new Map();

// A receipt is a watermark, not a list of ids. It has to apply to messages that
// reach this client *after* the receipt did — a send still in flight, or an echo
// from another tab — otherwise a receipt that overtakes its message strands that
// bubble on the wrong tick forever.
//
// Optimistic messages are skipped deliberately: their createdAt comes from the
// browser clock and must never be compared against a server timestamp.
const applyReceipt = (message, receipts, authUserId) => {
  if (message.isOptimistic || message.senderId !== authUserId) return message;

  const { deliveredAt, readAt } = receipts[message.receiverId] ?? {};

  if (readAt && message.createdAt <= readAt) return { ...message, status: "read" };
  if (deliveredAt && message.status === "sent" && message.createdAt <= deliveredAt) {
    return { ...message, status: "delivered" };
  }
  return message;
};

export const useChatStore = create((set, get) => ({
  allContacts: [],
  chats: [],
  messages: [],
  activeTab: "chats",
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isSoundEnabled: JSON.parse(localStorage.getItem("isSoundEnabled")) === true,
  // kept outside `chats` so a sidebar refetch cannot clobber a live increment
  unreadCounts: {},
  // { [partnerId]: { deliveredAt, readAt } } — see applyReceipt above
  receipts: {},
  // partner ids currently composing. Entries expire on a timer rather than
  // relying on a stopTyping that a dropped connection would never send.
  typingUsers: {},

  toggleSound: () => {
    localStorage.setItem("isSoundEnabled", !get().isSoundEnabled);
    set({ isSoundEnabled: !get().isSoundEnabled });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSelectedUser: (selectedUser) => {
    set({ selectedUser });

    // opening a conversation is the read signal — but only if this tab is
    // actually on screen. A chat opened in a background tab has not been read.
    if (selectedUser && document.visibilityState === "visible") {
      get().markConversationAsRead(selectedUser._id);
    }
  },

  getAllContacts: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/contacts");
      set({ allContacts: res.data });
    } catch (error) {
      toast.error(errorMessage(error, "Could not load contacts"));
    } finally {
      set({ isUsersLoading: false });
    }
  },

  // `silent` skips the loading flag so a background re-sync mid-conversation
  // does not replace the sidebar with a skeleton
  getMyChatPartners: async ({ silent = false } = {}) => {
    if (!silent) set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/chats");
      set({
        chats: res.data,
        unreadCounts: Object.fromEntries(
          res.data.map((chat) => [chat._id, chat.unreadCount ?? 0])
        ),
      });
    } catch (error) {
      if (!silent) toast.error(errorMessage(error, "Could not load chats"));
    } finally {
      if (!silent) set({ isUsersLoading: false });
    }
  },

  getMessagesByUserId: async (userId) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`);
      set({ messages: res.data });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  sendMessage: async (messageData) => {
    const { selectedUser } = get();
    const { authUser } = useAuthStore.getState();

    const tempId = `temp-${Date.now()}`;

    const optimisticMessage = {
      _id: tempId,
      senderId: authUser._id,
      receiverId: selectedUser._id,
      text: messageData.text,
      image: messageData.image,
      createdAt: new Date().toISOString(),
      // client-only pseudo status; the server assigns sent or delivered
      status: "sending",
      isOptimistic: true, // flag to identify optimistic messages (optional)
    };
    // immidiately update the ui by adding the message. Every update below uses
    // the functional form so messages arriving over the socket mid-request are
    // not clobbered by a stale snapshot.
    set((state) => ({ messages: [...state.messages, optimisticMessage] }));

    try {
      const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, messageData);

      set((state) => {
        // the server now echoes our own message back to us, and that echo can
        // land before this response does — drop it so the swap below cannot
        // leave two bubbles with the same _id
        const withoutEcho = state.messages.filter((message) => message._id !== res.data._id);
        const saved = applyReceipt(res.data, state.receipts, authUser._id);

        return {
          // swap the placeholder for the saved message, leaving anything else alone
          messages: withoutEcho.map((message) => (message._id === tempId ? saved : message)),
        };
      });

      // a first message to a contact makes them a chat partner
      get().applyMessageToChats(res.data, selectedUser._id);
    } catch (error) {
      // remove only the optimistic message on failure
      set((state) => ({
        messages: state.messages.filter((message) => message._id !== tempId),
      }));
      toast.error(errorMessage(error));
    }
  },

  // Keeps the sidebar preview and ordering in step with live traffic. Falls back
  // to a refetch when the partner is not in the list yet — the server is the
  // authority on both ordering and counts, and the store owns the fetching.
  applyMessageToChats: (message, partnerId) => {
    const existing = get().chats.find((chat) => chat._id === partnerId);
    if (!existing) {
      get().getMyChatPartners({ silent: true });
      return;
    }

    const lastMessage = {
      text: message.text,
      image: message.image,
      createdAt: message.createdAt,
      senderId: message.senderId,
      status: message.status,
    };

    set((state) => ({
      chats: [
        { ...existing, lastMessage },
        ...state.chats.filter((chat) => chat._id !== partnerId),
      ],
    }));
  },

  markConversationAsRead: async (partnerId) => {
    const { unreadCounts, messages } = get();
    const hasUnread =
      (unreadCounts[partnerId] ?? 0) > 0 ||
      messages.some((message) => message.senderId === partnerId && message.status !== "read");

    // this fires on every conversation open; most of those are no-ops
    if (!hasUnread) return;

    // clear locally first. The socket echo would do it anyway, but this tab
    // should not wait a round trip to drop its own badge.
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [partnerId]: 0 },
      messages: state.messages.map((message) =>
        message.senderId === partnerId ? { ...message, status: "read" } : message
      ),
    }));

    try {
      await axiosInstance.patch(`/messages/read/${partnerId}`);
    } catch {
      // a failed receipt is not worth a toast, but the badge must not stay
      // wrongly cleared — let the server correct us
      get().getMyChatPartners({ silent: true });
    }
  },

  // Throttled so a held-down key cannot become one emit per character — the
  // server charges every inbound event against a per-socket budget, and this
  // keeps a normal typist well inside it.
  emitTyping: () => {
    const { selectedUser } = get();
    const socket = useAuthStore.getState().socket;
    if (!socket || !selectedUser) return;

    const now = Date.now();
    if (now - lastTypingEmit < TYPING_THROTTLE_MS) return;

    lastTypingEmit = now;
    socket.emit("typing", { toUserId: selectedUser._id });
  },

  emitStopTyping: () => {
    const { selectedUser } = get();
    const socket = useAuthStore.getState().socket;
    if (!socket || !selectedUser) return;

    // let the next keystroke emit immediately rather than waiting out the
    // throttle window it never used
    lastTypingEmit = 0;
    socket.emit("stopTyping", { toUserId: selectedUser._id });
  },

  // One listener for the whole session, not one per open conversation: unread
  // badges have to update for conversations that are not currently open.
  subscribeToInbox: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("newMessage", (newMessage) => {
      const { authUser } = useAuthStore.getState();
      if (!authUser) return;

      const isMine = newMessage.senderId === authUser._id;
      const partnerId = isMine ? newMessage.receiverId : newMessage.senderId;
      const isOpen = get().selectedUser?._id === partnerId;

      if (isOpen && !get().messages.some((message) => message._id === newMessage._id)) {
        set((state) => ({
          messages: [...state.messages, applyReceipt(newMessage, state.receipts, authUser._id)],
        }));
      }

      get().applyMessageToChats(newMessage, partnerId);

      // our own message echoed to another tab: never a badge, never a sound
      if (isMine) return;

      // read the current value rather than the one captured at subscribe time,
      // so toggling sound takes effect immediately
      if (get().isSoundEnabled) {
        const notificationSound = new Audio("/sounds/notification.mp3");

        notificationSound.currentTime = 0; // reset to start
        notificationSound.play().catch(() => {});
      }

      if (isOpen && document.visibilityState === "visible") {
        get().markConversationAsRead(partnerId);
      } else {
        set((state) => ({
          unreadCounts: {
            ...state.unreadCounts,
            [partnerId]: (state.unreadCounts[partnerId] ?? 0) + 1,
          },
        }));
      }
    });

    socket.on("messagesDelivered", ({ partnerId, deliveredAt }) => {
      const { authUser } = useAuthStore.getState();
      if (!authUser) return;

      set((state) => {
        const receipts = {
          ...state.receipts,
          [partnerId]: { ...state.receipts[partnerId], deliveredAt },
        };
        return {
          receipts,
          messages: state.messages.map((message) =>
            applyReceipt(message, receipts, authUser._id)
          ),
        };
      });
    });

    socket.on("messagesRead", ({ partnerId, readAt }) => {
      const { authUser } = useAuthStore.getState();
      if (!authUser) return;

      set((state) => {
        const receipts = {
          ...state.receipts,
          [partnerId]: { ...state.receipts[partnerId], readAt },
        };
        return {
          receipts,
          messages: state.messages.map((message) =>
            applyReceipt(message, receipts, authUser._id)
          ),
        };
      });
    });

    socket.on("userTyping", ({ fromUserId }) => {
      set((state) => ({ typingUsers: { ...state.typingUsers, [fromUserId]: true } }));

      // Every event restarts the clock. This is what makes the indicator
      // self-healing: a stopTyping that never arrives, or a sender who closes
      // the tab mid-word, clears on its own.
      clearTimeout(typingTimers.get(fromUserId));
      typingTimers.set(
        fromUserId,
        setTimeout(() => {
          typingTimers.delete(fromUserId);
          set((state) => {
            const { [fromUserId]: _removed, ...rest } = state.typingUsers;
            return { typingUsers: rest };
          });
        }, TYPING_EXPIRY_MS)
      );
    });

    socket.on("userStoppedTyping", ({ fromUserId }) => {
      clearTimeout(typingTimers.get(fromUserId));
      typingTimers.delete(fromUserId);

      set((state) => {
        const { [fromUserId]: _removed, ...rest } = state.typingUsers;
        return { typingUsers: rest };
      });
    });

    // another of our own tabs read this conversation
    socket.on("conversationRead", ({ partnerId }) => {
      set((state) => ({
        unreadCounts: { ...state.unreadCounts, [partnerId]: 0 },
        messages: state.messages.map((message) =>
          message.senderId === partnerId ? { ...message, status: "read" } : message
        ),
      }));
    });
  },

  unsubscribeFromInbox: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.off("newMessage");
    socket.off("messagesDelivered");
    socket.off("messagesRead");
    socket.off("conversationRead");
    socket.off("userTyping");
    socket.off("userStoppedTyping");

    // pending expiry timers would otherwise fire into a torn-down subscription
    for (const timer of typingTimers.values()) clearTimeout(timer);
    typingTimers.clear();
    set({ typingUsers: {} });
  },
}));
