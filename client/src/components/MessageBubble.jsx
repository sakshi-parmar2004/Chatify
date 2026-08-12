import { useState } from "react";
import { CornerUpLeftIcon, PencilIcon, SmilePlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { MessageStatusIcon } from "./ChatContainer";
import { useChatStore } from "../store/useChatStore";

// A short, fixed set. An emoji picker is a dependency and a lot of surface for
// something most people use six of.
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

// Matches the server's DEC-08 window; the UI hides actions it knows will 400.
const EDIT_WINDOW_MS = 60 * 60 * 1000;

/** Group identical emoji into one chip with a count. */
const groupReactions = (reactions = []) => {
  const byEmoji = new Map();
  for (const { emoji, userId } of reactions) {
    if (!byEmoji.has(emoji)) byEmoji.set(emoji, []);
    byEmoji.get(emoji).push(userId);
  }
  return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
};

function MessageBubble({ message, conversation, authUser, receipt }) {
  const { setReplyTarget, editMessage, deleteMessage, toggleReaction } = useChatStore();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.text ?? "");
  const [showReactions, setShowReactions] = useState(false);

  const isMine = message.senderId === authUser._id;
  const isGroup = conversation?.type === "group";
  const isAdmin = isGroup && (conversation.admins ?? []).some((id) => id === authUser._id);
  const withinWindow = Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;

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

  const grouped = groupReactions(message.reactions);

  const submitEdit = (event) => {
    event.preventDefault();
    const next = draft.trim();
    if (next && next !== message.text) editMessage(message._id, next);
    setIsEditing(false);
  };

  return (
    <div className={`chat group ${isMine ? "chat-end" : "chat-start"}`}>
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

        {message.attachment && <Attachment attachment={message.attachment} />}

        {isEditing ? (
          <form onSubmit={submitEdit} className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setIsEditing(false)}
              aria-label="Edit message"
              className="bg-slate-900/40 rounded px-2 py-1 text-sm min-w-0 flex-1"
            />
            <button type="submit" className="text-xs underline">
              Save
            </button>
          </form>
        ) : (
          message.text && <p className="mt-2">{message.text}</p>
        )}

        {message.linkPreview?.url && <LinkPreview preview={message.linkPreview} />}

        {/* the opacity sits on the time, not the row, so a read tick can reach
            full strength against the cyan bubble */}
        <p className="text-xs mt-1 flex items-center gap-1">
          <span className="opacity-75">{time}</span>
          {message.editedAt && <span className="opacity-75">· edited</span>}
          {isMine && <MessageStatusIcon receipt={receipt} />}
        </p>

        {grouped.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {grouped.map(({ emoji, userIds }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleReaction(message._id, emoji)}
                aria-label={`${emoji} ${userIds.length} ${
                  userIds.includes(authUser._id) ? "(including you)" : ""
                }`}
                className={`text-xs rounded-full px-1.5 py-0.5 border ${
                  userIds.includes(authUser._id)
                    ? "border-cyan-300 bg-cyan-500/30"
                    : "border-slate-600 bg-slate-900/30"
                }`}
              >
                {emoji} {userIds.length}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions appear on hover on a pointer device and on focus for keyboard
          users, so they are reachable without a hover state. */}
      <div className="chat-footer opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1 mt-1">
        <button
          type="button"
          aria-label="Reply"
          onClick={() => setReplyTarget(message)}
          className="text-slate-400 hover:text-slate-200"
        >
          <CornerUpLeftIcon className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          aria-label="Add reaction"
          onClick={() => setShowReactions((open) => !open)}
          className="text-slate-400 hover:text-slate-200"
        >
          <SmilePlusIcon className="w-3.5 h-3.5" />
        </button>

        {isMine && withinWindow && !isEditing && (
          <button
            type="button"
            aria-label="Edit message"
            onClick={() => {
              setDraft(message.text ?? "");
              setIsEditing(true);
            }}
            className="text-slate-400 hover:text-slate-200"
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
        )}

        {(isAdmin || (isMine && withinWindow)) && (
          <button
            type="button"
            aria-label="Delete message"
            onClick={() => deleteMessage(message._id)}
            className="text-slate-400 hover:text-rose-400"
          >
            <Trash2Icon className="w-3.5 h-3.5" />
          </button>
        )}

        {showReactions && (
          <span className="flex items-center gap-1 bg-slate-800 rounded-full px-2 py-1 border border-slate-700">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={() => {
                  toggleReaction(message._id, emoji);
                  setShowReactions(false);
                }}
                className="text-sm hover:scale-125 transition-transform"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label="Close reactions"
              onClick={() => setShowReactions(false)}
              className="text-slate-500"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

const ATTACHMENT_LABELS = { image: "Photo", video: "Video", audio: "Voice message", file: "File" };

const formatBytes = (bytes) => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

function Attachment({ attachment }) {
  if (attachment.kind === "image") {
    return (
      <img
        src={attachment.url}
        alt={attachment.name || "Shared image"}
        className="rounded-lg w-full max-w-[220px] sm:max-w-xs h-40 sm:h-48 object-cover"
      />
    );
  }

  if (attachment.kind === "video") {
    return (
      // preload metadata only: a thumbnail should not cost the whole file
      <video
        src={attachment.url}
        controls
        preload="metadata"
        className="rounded-lg w-full max-w-[220px] sm:max-w-xs"
      >
        <track kind="captions" />
      </video>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <audio src={attachment.url} controls preload="metadata" className="w-56 max-w-full">
        <track kind="captions" />
      </audio>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer noopener"
      download={attachment.name || undefined}
      className="flex items-center gap-2 underline text-sm"
    >
      <span className="truncate">{attachment.name || ATTACHMENT_LABELS.file}</span>
      {attachment.bytes > 0 && (
        <span className="opacity-70 shrink-0">{formatBytes(attachment.bytes)}</span>
      )}
    </a>
  );
}

function LinkPreview({ preview }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-2 flex gap-2 rounded-lg bg-slate-900/30 p-2 border border-slate-700/50"
    >
      {preview.image && (
        <img src={preview.image} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block text-xs font-semibold truncate">
          {preview.title || preview.url}
        </span>
        {preview.description && (
          <span className="block text-xs opacity-75 line-clamp-2">{preview.description}</span>
        )}
      </span>
    </a>
  );
}

export default MessageBubble;
