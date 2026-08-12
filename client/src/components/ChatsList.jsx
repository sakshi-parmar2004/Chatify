import { useEffect } from "react";
import { BellOffIcon, UsersIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import UsersLoadingSkeleton from "./UsersLoadingSkeleton";
import NoChatsFound from "./NoChatsFound";
import { useAuthStore } from "../store/useAuthStore";

/** What the sidebar shows under the name. */
const previewOf = (conversation) => {
  const { lastMessage } = conversation;
  if (!lastMessage) return null;
  if (lastMessage.deletedAt) return "Message deleted";
  if (lastMessage.text) return lastMessage.text;
  if (lastMessage.attachment) {
    const labels = { image: "Photo", video: "Video", audio: "Voice message", file: "File" };
    return labels[lastMessage.attachment.kind] ?? "Attachment";
  }
  if (lastMessage.image) return "Photo";
  return null;
};

const titleOf = (conversation) =>
  conversation.type === "group"
    ? (conversation.name || "Unnamed group")
    : (conversation.partner?.name ?? "Unknown");

const avatarOf = (conversation) =>
  conversation.type === "group"
    ? conversation.image
    : conversation.partner?.profilePic;

function ChatsList() {
  const {
    getConversations,
    conversations,
    isUsersLoading,
    selectConversation,
    unreadCounts,
  } = useChatStore();
  const { onlineUsers } = useAuthStore();

  useEffect(() => {
    getConversations();
  }, [getConversations]);

  if (isUsersLoading) return <UsersLoadingSkeleton />;
  if (conversations.length === 0) return <NoChatsFound />;

  return (
    <>
      {conversations.map((conversation) => {
        const unread = unreadCounts[conversation._id] ?? 0;
        const isGroup = conversation.type === "group";
        const isOnline = !isGroup && onlineUsers.includes(conversation.partner?._id);
        const preview = previewOf(conversation);
        const isMuted = conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date();

        return (
          <button
            key={conversation._id}
            type="button"
            className="w-full text-left bg-cyan-500/10 p-4 rounded-lg cursor-pointer hover:bg-cyan-500/20 transition-colors"
            onClick={() => selectConversation(conversation)}
          >
            <div className="flex items-center gap-3">
              <div
                className={`avatar shrink-0 ${
                  isGroup ? "" : isOnline ? "online" : "offline"
                }`}
              >
                <div className="size-12 rounded-full bg-slate-700 flex items-center justify-center">
                  {avatarOf(conversation) ? (
                    <img src={avatarOf(conversation)} alt="" />
                  ) : isGroup ? (
                    <UsersIcon className="w-6 h-6 text-slate-300 m-auto" />
                  ) : (
                    <img src="/avatar.png" alt="" />
                  )}
                </div>
              </div>

              {/* min-w-0 lets the name and preview truncate instead of pushing
                  the badge out of the row */}
              <div className="min-w-0 flex-1">
                <h4
                  className={`truncate ${
                    unread > 0 ? "text-white font-semibold" : "text-slate-200 font-medium"
                  }`}
                >
                  {titleOf(conversation)}
                  {!isGroup && (
                    <span className="sr-only">{isOnline ? " (online)" : " (offline)"}</span>
                  )}
                </h4>
                {preview && <p className="text-xs text-slate-400 truncate">{preview}</p>}
              </div>

              {isMuted && (
                <BellOffIcon className="w-4 h-4 shrink-0 text-slate-500" aria-label="Muted" />
              )}

              {unread > 0 && (
                <span className="shrink-0 rounded-full bg-cyan-500 text-slate-900 text-xs font-semibold px-2 py-0.5">
                  {unread > 99 ? "99+" : unread}
                  <span className="sr-only"> unread messages</span>
                </span>
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}
export default ChatsList;
