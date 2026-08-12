import { MessageStatusIcon } from "./ChatContainer";

/**
 * One message row. Extracted from ChatContainer when the bubble stopped being
 * a timestamp and a line of text — it now carries replies, attachments,
 * reactions and a tombstone state.
 */
function MessageBubble({ message, conversation, authUser, receipt }) {
  const isMine = message.senderId === authUser._id;
  const isGroup = conversation?.type === "group";

  // In a group you cannot tell who said what from position alone.
  const senderName = isGroup
    ? conversation.participants?.find((p) => p._id === message.senderId)?.name
    : null;

  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (message.deletedAt) {
    return (
      <div className={`chat ${isMine ? "chat-end" : "chat-start"}`}>
        <div className="chat-bubble bg-slate-800/60 text-slate-500 italic text-sm">
          This message was deleted
        </div>
      </div>
    );
  }

  return (
    <div className={`chat ${isMine ? "chat-end" : "chat-start"}`}>
      <div
        className={`chat-bubble relative max-w-[85%] sm:max-w-[70%] break-words ${
          isMine ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-200"
        }`}
      >
        {senderName && !isMine && (
          <p className="text-xs font-semibold text-cyan-300 mb-1">{senderName}</p>
        )}

        {message.replySnapshot && (
          <div className="mb-2 border-l-2 border-cyan-300/60 pl-2 text-xs opacity-80">
            <p className="truncate">
              {message.replySnapshot.deleted
                ? "Deleted message"
                : message.replySnapshot.text || (message.replySnapshot.hasImage ? "Photo" : "")}
            </p>
          </div>
        )}

        {message.image && (
          <img
            src={message.image}
            alt="Shared"
            className="rounded-lg w-full max-w-[220px] sm:max-w-xs h-40 sm:h-48 object-cover"
          />
        )}

        {message.text && <p className="mt-2">{message.text}</p>}

        {/* the opacity sits on the time, not the row, so a read tick can reach
            full strength against the cyan bubble */}
        <p className="text-xs mt-1 flex items-center gap-1">
          <span className="opacity-75">{time}</span>
          {message.editedAt && <span className="opacity-75">· edited</span>}
          {isMine && <MessageStatusIcon receipt={receipt} />}
        </p>
      </div>
    </div>
  );
}

export default MessageBubble;
