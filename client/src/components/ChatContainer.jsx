import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import ChatHeader from "./ChatHeader";
import NoChatHistoryPlaceholder from "./NoChatHistoryPlaceholder";
import MessageInput from "./MessageInput";
import MessagesLoadingSkeleton from "./MessagesLoadingSkeleton";

function ChatContainer() {
  const {
    selectedUser,
    getMessagesByUserId,
    messages,
    isMessagesLoading,
    subscribeToMessages,
    unsubscribeFromMessages,
  } = useChatStore();
  const { authUser } = useAuthStore();
  const messagesContainerRef = useRef(null);
  const isPinnedToBottomRef = useRef(true);

  useEffect(() => {
    getMessagesByUserId(selectedUser._id);
    subscribeToMessages();

    // clean up
    return () => unsubscribeFromMessages();
  }, [selectedUser, getMessagesByUserId, subscribeToMessages, unsubscribeFromMessages]);

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
                  <p className="text-xs mt-1 opacity-75 flex items-center gap-1">
                    {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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