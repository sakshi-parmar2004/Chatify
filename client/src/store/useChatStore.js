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

const PAGE_SIZE = 50;

/** Key for the typingUsers map — typing is per person per conversation. */
const typingKey = (conversationId, userId) => `${conversationId}:${userId}`;

export const useChatStore = create((set, get) => ({
  allContacts: [],
  conversations: [],
  messages: [],
  activeTab: "chats",
  selectedConversation: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isLoadingOlder: false,
  hasMoreMessages: false,
  oldestCursor: null,
  isSoundEnabled: JSON.parse(localStorage.getItem("isSoundEnabled")) === true,
  // { [conversationId]: number } — kept outside `conversations` so a list
  // refetch cannot clobber a live increment
  unreadCounts: {},
  // { [conversationId]: { [userId]: { lastReadAt, lastDeliveredAt } } }
  cursors: {},
  // { [`conversationId:userId`]: true }
  typingUsers: {},

  toggleSound: () => {
    localStorage.setItem("isSoundEnabled", !get().isSoundEnabled);
    set({ isSoundEnabled: !get().isSoundEnabled });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  /** The other participant of the open direct conversation, for headers. */
  partnerOfSelected: () => get().selectedConversation?.partner ?? null,

  selectConversation: (conversation) => {
    set({
      selectedConversation: conversation,
      messages: [],
      hasMoreMessages: false,
      oldestCursor: null,
      // a quote belongs to the conversation it was started in
      replyTarget: null,
    });

    // The typing throttle is per-store, not per-conversation, so without this
    // the first keystroke in a newly opened chat is swallowed by the window the
    // previous conversation had already spent.
    lastTypingEmit = 0;

    if (!conversation) return;

    get().getMessages(conversation._id);
    if (document.visibilityState === "visible") {
      get().markConversationAsRead(conversation._id);
    }
  },

  closeConversation: () => set({ selectedConversation: null, messages: [] }),

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
  getConversations: async ({ silent = false } = {}) => {
    if (!silent) set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/conversations");
      set({
        conversations: res.data,
        unreadCounts: Object.fromEntries(
          res.data.map((conversation) => [conversation._id, conversation.unreadCount ?? 0])
        ),
      });
    } catch (error) {
      if (!silent) toast.error(errorMessage(error, "Could not load chats"));
    } finally {
      if (!silent) set({ isUsersLoading: false });
    }
  },

  /** Open (or create) the direct thread with a contact, then select it. */
  openDirectConversation: async (userId) => {
    try {
      const res = await axiosInstance.post(`/conversations/direct/${userId}`);

      set((state) => ({
        conversations: state.conversations.some((c) => c._id === res.data._id)
          ? state.conversations
          : [res.data, ...state.conversations],
        activeTab: "chats",
      }));

      get().selectConversation(res.data);
      return res.data;
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that conversation"));
      return null;
    }
  },

  getMessages: async (conversationId) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(
        `/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`
      );

      // a slow response for a conversation the user already navigated away from
      // must not overwrite the one they are looking at now
      if (get().selectedConversation?._id !== conversationId) return;

      set({
        messages: res.data.messages,
        hasMoreMessages: res.data.hasMore,
        oldestCursor: res.data.nextCursor,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  /** MSG-08 — prepend the previous page, preserving what is already loaded. */
  loadOlderMessages: async () => {
    const { selectedConversation, oldestCursor, hasMoreMessages, isLoadingOlder } = get();
    if (!selectedConversation || !hasMoreMessages || isLoadingOlder || !oldestCursor) return;

    set({ isLoadingOlder: true });
    try {
      const res = await axiosInstance.get(
        `/conversations/${selectedConversation._id}/messages?limit=${PAGE_SIZE}` +
          `&before=${encodeURIComponent(oldestCursor)}`
      );

      if (get().selectedConversation?._id !== selectedConversation._id) return;

      set((state) => {
        const known = new Set(state.messages.map((message) => message._id));
        const older = res.data.messages.filter((message) => !known.has(message._id));
        return {
          messages: [...older, ...state.messages],
          hasMoreMessages: res.data.hasMore,
          oldestCursor: res.data.nextCursor ?? state.oldestCursor,
        };
      });
    } catch (error) {
      toast.error(errorMessage(error, "Could not load older messages"));
    } finally {
      set({ isLoadingOlder: false });
    }
  },

  sendMessage: async (messageData) => {
    const { selectedConversation } = get();
    const { authUser } = useAuthStore.getState();
    if (!selectedConversation) return;

    const tempId = `temp-${Date.now()}`;
    const conversationId = selectedConversation._id;

    const optimisticMessage = {
      _id: tempId,
      conversationId,
      senderId: authUser._id,
      text: messageData.text,
      image: messageData.image,
      replyTo: messageData.replyTo ?? null,
      replySnapshot: messageData.replySnapshot ?? null,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };

    set((state) => ({ messages: [...state.messages, optimisticMessage] }));

    try {
      const res = await axiosInstance.post(
        `/conversations/${conversationId}/messages`,
        messageData
      );

      set((state) => {
        // the room echo may have landed first; drop it so the swap below cannot
        // leave two bubbles with the same _id
        const withoutEcho = state.messages.filter((message) => message._id !== res.data._id);
        return {
          messages: withoutEcho.map((message) =>
            message._id === tempId ? res.data : message
          ),
        };
      });

      get().applyMessageToConversations(res.data);
      set({ replyTarget: null });
    } catch (error) {
      set((state) => ({
        messages: state.messages.filter((message) => message._id !== tempId),
      }));
      toast.error(errorMessage(error));
    }
  },

  /** Keep the sidebar preview and ordering in step with live traffic. */
  applyMessageToConversations: (message) => {
    const existing = get().conversations.find((c) => c._id === message.conversationId);
    if (!existing) {
      // a conversation we have never seen — the server is authoritative
      get().getConversations({ silent: true });
      return;
    }

    const lastMessage = {
      _id: message._id,
      text: message.text,
      image: message.image,
      attachment: message.attachment,
      createdAt: message.createdAt,
      senderId: message.senderId,
      deletedAt: message.deletedAt ?? null,
    };

    set((state) => ({
      conversations: [
        { ...existing, lastMessage, lastMessageAt: message.createdAt },
        ...state.conversations.filter((c) => c._id !== message.conversationId),
      ],
    }));
  },

  // MSG-05 — the message the composer is currently quoting.
  replyTarget: null,
  setReplyTarget: (message) => set({ replyTarget: message }),

  // MSG-04
  editMessage: async (messageId, text) => {
    const { selectedConversation } = get();
    if (!selectedConversation) return;

    try {
      const res = await axiosInstance.patch(
        `/conversations/${selectedConversation._id}/messages/${messageId}`,
        { text }
      );
      get().replaceMessage(res.data);
    } catch (error) {
      toast.error(errorMessage(error, "Could not edit that message"));
    }
  },

  deleteMessage: async (messageId) => {
    const { selectedConversation } = get();
    if (!selectedConversation) return;

    try {
      const res = await axiosInstance.delete(
        `/conversations/${selectedConversation._id}/messages/${messageId}`
      );
      get().replaceMessage(res.data);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete that message"));
    }
  },

  // MSG-06. Applied optimistically because a reaction that lags feels broken,
  // and the server response replaces it either way.
  toggleReaction: async (messageId, emoji) => {
    const { selectedConversation } = get();
    const { authUser } = useAuthStore.getState();
    if (!selectedConversation) return;

    set((state) => ({
      messages: state.messages.map((message) => {
        if (message._id !== messageId) return message;

        const mine = (message.reactions ?? []).findIndex(
          (reaction) => reaction.userId === authUser._id && reaction.emoji === emoji
        );
        const reactions =
          mine >= 0
            ? message.reactions.filter((_, index) => index !== mine)
            : [...(message.reactions ?? []), { emoji, userId: authUser._id }];

        return { ...message, reactions };
      }),
    }));

    try {
      const res = await axiosInstance.put(
        `/conversations/${selectedConversation._id}/messages/${messageId}/reactions`,
        { emoji }
      );
      get().replaceMessage(res.data);
    } catch (error) {
      toast.error(errorMessage(error, "Could not react"));
      get().getMessages(selectedConversation._id);
    }
  },

  replaceMessage: (updated) => {
    set((state) => ({
      messages: state.messages.map((message) =>
        message._id === updated._id ? updated : message
      ),
    }));
  },

  // --- GRP-01..03, MSG-10, MED-07 ---
  createGroup: async ({ name, participantIds }) => {
    try {
      const res = await axiosInstance.post("/conversations/groups", { name, participantIds });
      set((state) => ({ conversations: [res.data, ...state.conversations], activeTab: "chats" }));
      get().selectConversation(res.data);
      return res.data;
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the group"));
      return null;
    }
  },

  renameGroup: async (conversationId, name) => {
    try {
      await axiosInstance.patch(`/conversations/${conversationId}/group`, { name });
    } catch (error) {
      toast.error(errorMessage(error, "Could not rename the group"));
    }
  },

  addParticipants: async (conversationId, userIds) => {
    try {
      await axiosInstance.post(`/conversations/${conversationId}/participants`, { userIds });
    } catch (error) {
      toast.error(errorMessage(error, "Could not add them"));
    }
  },

  removeParticipant: async (conversationId, userId) => {
    try {
      await axiosInstance.delete(`/conversations/${conversationId}/participants/${userId}`);
      const { authUser } = useAuthStore.getState();
      // leaving is the same call as being removed; only the socket event that
      // follows differs, and it will not arrive for our own request
      if (authUser?._id === userId) {
        set((state) => ({
          conversations: state.conversations.filter((c) => c._id !== conversationId),
          selectedConversation:
            state.selectedConversation?._id === conversationId ? null : state.selectedConversation,
        }));
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove them"));
    }
  },

  setAdmin: async (conversationId, userId, makeAdmin) => {
    try {
      const url = `/conversations/${conversationId}/admins/${userId}`;
      if (makeAdmin) await axiosInstance.put(url);
      else await axiosInstance.delete(url);
    } catch (error) {
      toast.error(errorMessage(error, "Could not change that role"));
    }
  },

  togglePin: async (conversationId, messageId) => {
    try {
      await axiosInstance.put(`/conversations/${conversationId}/pins/${messageId}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not pin that message"));
    }
  },

  getConversationMedia: async (conversationId, { before } = {}) => {
    try {
      const params = new URLSearchParams();
      if (before) params.set("before", before);
      const res = await axiosInstance.get(
        `/conversations/${conversationId}/media?${params}`
      );
      return res.data;
    } catch (error) {
      toast.error(errorMessage(error, "Could not load media"));
      return { items: [], hasMore: false, nextCursor: null };
    }
  },

  // MSG-07
  searchMessages: async (query, { conversationId } = {}) => {
    if (!query || query.trim().length < 2) return [];

    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (conversationId) params.set("conversationId", conversationId);

      const res = await axiosInstance.get(`/conversations/search?${params}`);
      return res.data.results;
    } catch (error) {
      toast.error(errorMessage(error, "Search failed"));
      return [];
    }
  },

  markConversationAsRead: async (conversationId) => {
    if ((get().unreadCounts[conversationId] ?? 0) === 0) return;

    // clear locally first; the socket echo would do it anyway, but this tab
    // should not wait a round trip to drop its own badge
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [conversationId]: 0 },
    }));

    try {
      await axiosInstance.patch(`/conversations/${conversationId}/read`);
    } catch {
      // a failed receipt is not worth a toast, but the badge must not stay
      // wrongly cleared — let the server correct us
      get().getConversations({ silent: true });
    }
  },

  // Throttled so a held-down key cannot become one emit per character — the
  // server charges every inbound event against a per-socket budget.
  emitTyping: () => {
    const { selectedConversation } = get();
    const socket = useAuthStore.getState().socket;
    if (!socket || !selectedConversation) return;

    const now = Date.now();
    if (now - lastTypingEmit < TYPING_THROTTLE_MS) return;

    lastTypingEmit = now;
    socket.emit("typing", { conversationId: selectedConversation._id });
  },

  emitStopTyping: () => {
    const { selectedConversation } = get();
    const socket = useAuthStore.getState().socket;
    if (!socket || !selectedConversation) return;

    // let the next keystroke emit immediately rather than waiting out the
    // throttle window it never used
    lastTypingEmit = 0;
    socket.emit("stopTyping", { conversationId: selectedConversation._id });
  },

  /** Anyone composing in the open conversation, excluding ourselves. */
  typingInSelected: () => {
    const { selectedConversation, typingUsers } = get();
    if (!selectedConversation) return [];

    const prefix = `${selectedConversation._id}:`;
    return Object.keys(typingUsers)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
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
      const isOpen = get().selectedConversation?._id === newMessage.conversationId;

      if (isOpen && !get().messages.some((m) => m._id === newMessage._id)) {
        set((state) => ({ messages: [...state.messages, newMessage] }));
      }

      get().applyMessageToConversations(newMessage);

      // the sender stopped typing by definition
      set((state) => {
        const key = typingKey(newMessage.conversationId, newMessage.senderId);
        if (!state.typingUsers[key]) return {};
        const { [key]: _gone, ...rest } = state.typingUsers;
        return { typingUsers: rest };
      });

      // our own message echoed to another tab: never a badge, never a sound
      if (isMine) return;

      if (get().isSoundEnabled && !isConversationMuted(get(), newMessage.conversationId)) {
        const notificationSound = new Audio("/sounds/notification.mp3");
        notificationSound.currentTime = 0;
        notificationSound.play().catch(() => {});
      }

      if (isOpen && document.visibilityState === "visible") {
        // bump then clear, so markConversationAsRead sees something to do
        set((state) => ({
          unreadCounts: {
            ...state.unreadCounts,
            [newMessage.conversationId]: (state.unreadCounts[newMessage.conversationId] ?? 0) + 1,
          },
        }));
        get().markConversationAsRead(newMessage.conversationId);
      } else {
        set((state) => ({
          unreadCounts: {
            ...state.unreadCounts,
            [newMessage.conversationId]: (state.unreadCounts[newMessage.conversationId] ?? 0) + 1,
          },
        }));
      }
    });

    socket.on("messageUpdated", (updated) => {
      set((state) => ({
        messages: state.messages.map((message) =>
          message._id === updated._id ? updated : message
        ),
      }));
      // an edit or delete of the newest message changes the sidebar preview
      const conversation = get().conversations.find((c) => c._id === updated.conversationId);
      if (conversation?.lastMessage?._id === updated._id) {
        get().applyMessageToConversations(updated);
      }
    });

    const recordCursor = (field) => ({ conversationId, userId, ...rest }) => {
      const value = rest[field];
      set((state) => ({
        cursors: {
          ...state.cursors,
          [conversationId]: {
            ...state.cursors[conversationId],
            [userId]: { ...state.cursors[conversationId]?.[userId], [field]: value },
          },
        },
      }));
    };

    socket.on("conversationRead", (payload) => {
      recordCursor("lastReadAt")(payload);

      // another of our own tabs read it
      const { authUser } = useAuthStore.getState();
      if (authUser && payload.userId === authUser._id) {
        set((state) => ({
          unreadCounts: { ...state.unreadCounts, [payload.conversationId]: 0 },
        }));
      }
    });

    socket.on("conversationDelivered", recordCursor("lastDeliveredAt"));

    socket.on("userTyping", ({ conversationId, userId }) => {
      const key = typingKey(conversationId, userId);
      set((state) => ({ typingUsers: { ...state.typingUsers, [key]: true } }));

      // Every event restarts the clock. This is what makes the indicator
      // self-healing: a stopTyping that never arrives, or a sender who closes
      // the tab mid-word, clears on its own.
      clearTimeout(typingTimers.get(key));
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          set((state) => {
            const { [key]: _gone, ...rest } = state.typingUsers;
            return { typingUsers: rest };
          });
        }, TYPING_EXPIRY_MS)
      );
    });

    socket.on("userStoppedTyping", ({ conversationId, userId }) => {
      const key = typingKey(conversationId, userId);
      clearTimeout(typingTimers.get(key));
      typingTimers.delete(key);

      set((state) => {
        const { [key]: _gone, ...rest } = state.typingUsers;
        return { typingUsers: rest };
      });
    });

    socket.on("conversationUpdated", (conversation) => {
      set((state) => ({
        conversations: state.conversations.map((existing) =>
          existing._id === conversation._id ? { ...existing, ...conversation } : existing
        ),
        selectedConversation:
          state.selectedConversation?._id === conversation._id
            ? { ...state.selectedConversation, ...conversation }
            : state.selectedConversation,
      }));
    });

    socket.on("removedFromConversation", ({ conversationId }) => {
      set((state) => ({
        conversations: state.conversations.filter((c) => c._id !== conversationId),
        selectedConversation:
          state.selectedConversation?._id === conversationId
            ? null
            : state.selectedConversation,
        messages: state.selectedConversation?._id === conversationId ? [] : state.messages,
      }));
    });
  },

  unsubscribeFromInbox: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    for (const event of [
      "newMessage",
      "messageUpdated",
      "conversationRead",
      "conversationDelivered",
      "userTyping",
      "userStoppedTyping",
      "conversationUpdated",
      "removedFromConversation",
    ]) {
      socket.off(event);
    }

    // pending expiry timers would otherwise fire into a torn-down subscription
    for (const timer of typingTimers.values()) clearTimeout(timer);
    typingTimers.clear();
    set({ typingUsers: {} });
  },
}));

const isConversationMuted = (state, conversationId) => {
  const conversation = state.conversations.find((c) => c._id === conversationId);
  if (!conversation?.mutedUntil) return false;
  return new Date(conversation.mutedUntil) > new Date();
};
