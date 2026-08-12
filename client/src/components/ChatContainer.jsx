import { useEffect, useRef } from "react";
import { CheckIcon, CheckCheckIcon } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import ChatHeader from "./ChatHeader";
import NoChatHistoryPlaceholder from "./NoChatHistoryPlaceholder";
import MessageInput from "./MessageInput";
import MessagesLoadingSkeleton from "./MessagesLoadingSkeleton";

// These sit on the cyan own-message bubble, so "read" is signalled by a lighter,
// full-opacity tick rather than the usual blue, which would disappear into the
// background. The label is not decoration — tick shape alone is not accessible.
const MESSAGE_STATUS_ICONS = {
  sending: { Icon: CheckIcon, className: "opacity-40", label: "Sending" },
  sent: { Icon: CheckIcon, className: "opacity-70", label: "Sent" },
  delivered: { Icon: CheckCheckIcon, className: "opacity-70", label: "Delivered" },
  read: { Icon: CheckCheckIcon, className: "text-sky-200", label: "Read" },
};

function MessageStatusIcon({ status }) {
  const entry = MESSAGE_STATUS_ICONS[status];
  // messages written before receipts existed carry no status
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
    selectedUser,
    getMessagesByUserId,
    messages,
    isMessagesLoading,
    markConversationAsRead,
  } = useChatStore();
  const { authUser } = useAuthStore();
  const messagesContainerRef = useRef(null);
  const isPinnedToBottomRef = useRef(true);

  useEffect(() => {
    getMessagesByUserId(selectedUser._id);
  }, [selectedUser, getMessagesByUserId]);

  // A conversation left open in a background tab has not been read by anyone,
  // so the receipt waits until the tab is actually on screen.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") markConversationAsRead(selectedUser._id);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // `messages` is a deliberate dependency, not an oversight: setSelectedUser
    // fires the same call before the history has loaded, and it can only see the
    // sidebar's unread count — which is missing when the chat was opened from
    // the Contacts tab. Re-running once the messages arrive is the safety net.
  }, [selectedUser, markConversationAsRead, messages]);

  // opening a different conversation should always land at the newest message
  useEffect(() => {
    isPinnedToBottomRef.current = true;
  }, [selectedUser]);

  // Scroll the container itself. scrollIntoView() also scrolls every scrollable
  // ancestor, which drags the whole page down and hides the headers.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !isPinnedToBottomRef.current) return;

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Once the user scrolls up to read history, stop yanking them back down;
  // resume auto-scrolling when they return to the bottom.
  const handleScroll = (event) => {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
    isPinnedToBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  return (
    <>
      <ChatHeader />
      {/* min-h-0 is what allows this to scroll inside the flex column */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 px-3 sm:px-6 overflow-y-auto py-4 sm:py-8"
      >
        {messages.length > 0 && !isMessagesLoading ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg) => (
              <div
                key={msg._id}
                className={`chat ${msg.senderId === authUser._id ? "chat-end" : "chat-start"}`}
              >
                <div
                  className={`chat-bubble relative max-w-[85%] sm:max-w-[70%] break-words ${
                    msg.senderId === authUser._id
                      ? "bg-cyan-600 text-white"
                      : "bg-slate-800 text-slate-200"
                  }`}
                >
                  {msg.image && (
                    <img
                      src={msg.image}
                      alt="Shared"
                      className="rounded-lg w-full max-w-[220px] sm:max-w-xs h-40 sm:h-48 object-cover"
                    />
                  )}
                  {msg.text && <p className="mt-2">{msg.text}</p>}
                  {/* the opacity sits on the time, not the row, so a read tick
                      can reach full strength against the cyan bubble */}
                  <p className="text-xs mt-1 flex items-center gap-1">
                    <span className="opacity-75">
                      {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {msg.senderId === authUser._id && <MessageStatusIcon status={msg.status} />}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : isMessagesLoading ? (
          <MessagesLoadingSkeleton />
        ) : (
          // keyed so switching conversations remounts it and re-rolls the suggestions
          <NoChatHistoryPlaceholder key={selectedUser._id} name={selectedUser.name} />
        )}
      </div>

      <MessageInput />
    </>
  );
}

export default ChatContainer;