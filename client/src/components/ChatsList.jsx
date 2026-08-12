import { useEffect } from "react";
import { BellOffIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import UsersLoadingSkeleton from "./UsersLoadingSkeleton";
import NoChatsFound from "./NoChatsFound";
import Avatar from "./ui/Avatar";
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
    ? conversation.name || "Unnamed group"
    : conversation.partner?.name ?? "Unknown";

function ChatsList() {
  const {
    getConversations,
    conversations,
    isUsersLoading,
    selectConversation,
    selectedConversation,
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
        const isSelected = selectedConversation?._id === conversation._id;
        const preview = previewOf(conversation);
        const isMuted =
          conversation.mutedUntil && new Date(conversation.mutedUntil) > new Date();

        return (
          <button
            key={conversation._id}
            type="button"
            aria-current={isSelected ? "true" : undefined}
            className={`w-full rounded-xl border p-3 text-left transition-colors ${
              isSelected
                ? "border-accent/30 bg-accent/15"
                : "border-transparent hover:border-line/10 hover:bg-line/[0.06]"
            }`}
            onClick={() => selectConversation(conversation)}
          >
            <div className="flex items-center gap-3">
              <Avatar
                src={isGroup ? conversation.image : conversation.partner?.profilePic}
                name={titleOf(conversation)}
                isGroup={isGroup}
                presence={isGroup ? null : onlineUsers.includes(conversation.partner?._id)}
              />

              {/* min-w-0 lets the name and preview truncate instead of pushing
                  the badge out of the row */}
              <div className="min-w-0 flex-1">
                <h4
                  className={`truncate ${
                    unread > 0 ? "font-semibold text-ink" : "font-medium text-ink/90"
                  }`}
                >
                  {titleOf(conversation)}
                </h4>
                {preview && <p className="truncate text-xs text-muted">{preview}</p>}
              </div>

              {isMuted && (
                <BellOffIcon className="h-4 w-4 shrink-0 text-faint" aria-label="Muted" />
              )}

              {unread > 0 && (
                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">
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
