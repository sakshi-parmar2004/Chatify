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

/**
 * Message row.
 *
 * daisyUI's `chat`/`chat-bubble` are gone (DEC-13). They were fully overridden
 * inline anyway, and their `:before` tail kept daisyUI's own `--b2` colour — so
 * the tail already mismatched the bubble it was attached to, and followed the OS
 * colour scheme independently of the app.
 */
function MessageBubble({ message, conversation, authUser, receipt }) {
  const { setReplyTarget, editMessage, deleteMessage, toggleReaction } = useChatStore();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.text ?? "");
  const [showReactions, setShowReactions] = useState(false);

  const isMine = message.senderId === authUser._id;
  const isGroup = conversation?.type === "group";
  const isAdmin = isGroup && (conversation.admins ?? []).some((id) => id === authUser._id);
  const withinWindow = Date.now() - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;

  // A system event is neither side's message — it belongs to the conversation.
  if (message.type === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-raised/50 px-3 py-1 text-xs text-faint">
          {message.text}
        </span>
      </div>
    );
  }

  const senderName = isGroup
    ? conversation.participants?.find((p) => p._id === message.senderId)?.name
    : null;

  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (message.deletedAt) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
        <div className="rounded-2xl border border-line/10 bg-raised/40 px-4 py-2 text-sm italic text-faint">
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
    <div className={`group flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div
        className={`relative max-w-[85%] break-words rounded-2xl px-4 py-2.5 sm:max-w-[70%] ${
          isMine
            ? // own messages carry the accent; the ink token guarantees contrast
              // against it on every theme, including the light ones
              "rounded-br-md bg-accent text-accent-ink"
            : "bubble-floor rounded-bl-md border border-line/10 text-ink backdrop-blur-sm"
        }`}
      >
        {senderName && !isMine && (
          <p className="mb-1 text-xs font-semibold text-accent-soft">{senderName}</p>
        )}

        {message.replySnapshot && (
          <div
            className={`mb-2 rounded border-l-2 pl-2 text-xs ${
              isMine ? "border-accent-ink/50 opacity-80" : "border-accent/60 text-muted"
            }`}
          >
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
            className="h-40 w-full max-w-[220px] rounded-lg object-cover sm:h-48 sm:max-w-xs"
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
              className="min-w-0 flex-1 rounded bg-bg/30 px-2 py-1 text-sm outline-none"
            />
            <button type="submit" className="text-xs underline">
              Save
            </button>
          </form>
        ) : (
          message.text && <p className="mt-1">{message.text}</p>
        )}

        {message.linkPreview?.url && <LinkPreview preview={message.linkPreview} isMine={isMine} />}

        <p className="mt-1 flex items-center gap-1 text-xs">
          <span className="opacity-70">{time}</span>
          {message.editedAt && <span className="opacity-70">· edited</span>}
          {isMine && <MessageStatusIcon receipt={receipt} />}
        </p>

        {grouped.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {grouped.map(({ emoji, userIds }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleReaction(message._id, emoji)}
                aria-label={`${emoji} ${userIds.length} ${
                  userIds.includes(authUser._id) ? "(including you)" : ""
                }`}
                className={`rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
                  userIds.includes(authUser._id)
                    ? "border-accent-soft/60 bg-accent-soft/25"
                    : "border-line/20 bg-bg/25"
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
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label="Reply"
          onClick={() => setReplyTarget(message)}
          className="text-muted transition-colors hover:text-ink"
        >
          <CornerUpLeftIcon className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label="Add reaction"
          onClick={() => setShowReactions((open) => !open)}
          className="text-muted transition-colors hover:text-ink"
        >
          <SmilePlusIcon className="h-3.5 w-3.5" />
        </button>

        {isMine && withinWindow && !isEditing && (
          <button
            type="button"
            aria-label="Edit message"
            onClick={() => {
              setDraft(message.text ?? "");
              setIsEditing(true);
            }}
            className="text-muted transition-colors hover:text-ink"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        )}

        {(isAdmin || (isMine && withinWindow)) && (
          <button
            type="button"
            aria-label="Delete message"
            onClick={() => deleteMessage(message._id)}
            className="text-muted transition-colors hover:text-danger"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        )}

        {showReactions && (
          <span className="glass-raised flex items-center gap-1 rounded-full px-2 py-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={() => {
                  toggleReaction(message._id, emoji);
                  setShowReactions(false);
                }}
                className="text-sm transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label="Close reactions"
              onClick={() => setShowReactions(false)}
              className="text-faint"
            >
              <XIcon className="h-3 w-3" />
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
        className="h-40 w-full max-w-[220px] rounded-lg object-cover sm:h-48 sm:max-w-xs"
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
        className="w-full max-w-[220px] rounded-lg sm:max-w-xs"
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
      className="flex items-center gap-2 text-sm underline"
    >
      <span className="truncate">{attachment.name || ATTACHMENT_LABELS.file}</span>
      {attachment.bytes > 0 && (
        <span className="shrink-0 opacity-70">{formatBytes(attachment.bytes)}</span>
      )}
    </a>
  );
}

function LinkPreview({ preview, isMine }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer noopener"
      className={`mt-2 flex gap-2 rounded-lg border p-2 ${
        isMine ? "border-accent-ink/20 bg-bg/15" : "border-line/15 bg-bg/25"
      }`}
    >
      {preview.image && (
        <img src={preview.image} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">
          {preview.title || preview.url}
        </span>
        {preview.description && (
          <span className="line-clamp-2 block text-xs opacity-75">{preview.description}</span>
        )}
      </span>
    </a>
  );
}

export default MessageBubble;
