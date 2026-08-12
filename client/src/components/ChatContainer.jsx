import { useEffect, useLayoutEffect, useRef } from "react";
import { CheckIcon, CheckCheckIcon } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { useThemeStore } from "../store/useThemeStore";
import { receiptFor, RECEIPT } from "../lib/receipts";
import { resolveWallpaper, wallpaperStyle } from "../lib/wallpapers";
import ChatHeader from "./ChatHeader";
import NoChatHistoryPlaceholder from "./NoChatHistoryPlaceholder";
import MessageInput from "./MessageInput";
import MessagesLoadingSkeleton from "./MessagesLoadingSkeleton";
import MessageBubble from "./MessageBubble";

// "Read" is a lighter accent rather than a separate blue: on a themed bubble a
// fixed blue is invisible in half the palettes.
const RECEIPT_ICONS = {
  [RECEIPT.SENDING]: { Icon: CheckIcon, className: "opacity-40", label: "Sending" },
  [RECEIPT.SENT]: { Icon: CheckIcon, className: "opacity-70", label: "Sent" },
  [RECEIPT.DELIVERED]: { Icon: CheckCheckIcon, className: "opacity-70", label: "Delivered" },
  [RECEIPT.READ]: { Icon: CheckCheckIcon, className: "text-accent-soft", label: "Read" },
};

export function MessageStatusIcon({ receipt }) {
  const entry = RECEIPT_ICONS[receipt];
  if (!entry) return null;

  const { Icon, className, label } = entry;
  return (
    <>
      <Icon className={`size-3.5 shrink-0 ${className}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  );
}

function ChatContainer() {
  const {
    selectedConversation,
    messages,
    isMessagesLoading,
    isLoadingOlder,
    hasMoreMessages,
    loadOlderMessages,
    markConversationAsRead,
    cursors,
  } = useChatStore();
  const { authUser } = useAuthStore();
  const globalWallpaper = useThemeStore((state) => state.wallpaper);

  const messagesContainerRef = useRef(null);
  const isPinnedToBottomRef = useRef(true);
  // height before an older page is prepended, so the view can be restored
  const restoreScrollRef = useRef(null);

  // opening a different conversation should always land at the newest message
  useEffect(() => {
    isPinnedToBottomRef.current = true;
  }, [selectedConversation?._id]);

  // A conversation left open in a background tab has not been read by anyone,
  // so the receipt waits until the tab is actually on screen.
  useEffect(() => {
    if (!selectedConversation) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markConversationAsRead(selectedConversation._id);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // `messages` is a deliberate dependency: the first read attempt fires before
    // the history has loaded, so this re-runs once it arrives.
  }, [selectedConversation, markConversationAsRead, messages]);

  // useLayoutEffect rather than useEffect: prepending an older page must not be
  // painted at the wrong offset first and then corrected, which reads as a jump.
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (restoreScrollRef.current !== null) {
      container.scrollTop = container.scrollHeight - restoreScrollRef.current;
      restoreScrollRef.current = null;
      return;
    }

    if (isPinnedToBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [messages]);

  const handleScroll = (event) => {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
    isPinnedToBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;

    if (scrollTop < 120 && hasMoreMessages && !isLoadingOlder) {
      restoreScrollRef.current = scrollHeight - scrollTop;
      loadOlderMessages();
    }
  };

  if (!selectedConversation) return null;

  const conversationCursors = cursors[selectedConversation._id];
  const wallpaper = resolveWallpaper(selectedConversation, globalWallpaper);
  const wallpaperCss = wallpaperStyle(wallpaper);

  return (
    <>
      <ChatHeader />

      <div className="relative min-h-0 flex-1">
        {/* UIX-04 — three layers. The scrim is what makes an arbitrary
            user-chosen image safe to put behind text: without it a light photo
            drops body copy to unreadable contrast. */}
        {wallpaperCss && (
          <>
            <div aria-hidden="true" className="wallpaper-layer" style={wallpaperCss} />
            <div aria-hidden="true" className="wallpaper-scrim" />
          </>
        )}

        {/* min-h-0 is what allows this to scroll inside the flex column */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="relative h-full overflow-y-auto px-3 py-4 sm:px-6 sm:py-8"
        >
          {isMessagesLoading ? (
            <MessagesLoadingSkeleton />
          ) : messages.length > 0 ? (
            <div className="mx-auto max-w-3xl space-y-5">
              {isLoadingOlder && (
                <p className="text-center text-xs text-faint">Loading older messages…</p>
              )}
              {!hasMoreMessages && (
                <p className="text-center text-xs text-faint/70">
                  This is the beginning of the conversation
                </p>
              )}

              {messages.map((msg) => (
                <MessageBubble
                  key={msg._id}
                  message={msg}
                  conversation={selectedConversation}
                  authUser={authUser}
                  receipt={receiptFor(msg, selectedConversation, conversationCursors, authUser._id)}
                />
              ))}
            </div>
          ) : (
            // keyed so switching conversations remounts it and re-rolls the suggestions
            <NoChatHistoryPlaceholder
              key={selectedConversation._id}
              name={selectedConversation.partner?.name ?? selectedConversation.name ?? "everyone"}
            />
          )}
        </div>
      </div>

      <MessageInput />
    </>
  );
}

export default ChatContainer;
