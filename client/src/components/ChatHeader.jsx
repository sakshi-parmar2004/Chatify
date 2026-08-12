import { useEffect, useState } from "react";
import { ArrowLeftIcon, XIcon, InfoIcon, ImageIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import Avatar from "./ui/Avatar";
import IconButton from "./ui/IconButton";
import GroupDetailsPanel from "./GroupDetailsPanel";
import WallpaperPicker from "./WallpaperPicker";

/** "Ana is typing…" for a direct chat, "Ana and 2 others…" for a group. */
const typingLabel = (conversation, typingIds) => {
  if (typingIds.length === 0) return null;
  if (conversation.type !== "group") return "typing…";

  const names = typingIds
    .map((id) => conversation.participants?.find((p) => p._id === id)?.name)
    .filter(Boolean);

  if (names.length === 0) return "typing…";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
};

function ChatHeader() {
  const { selectedConversation, closeConversation, typingInSelected } = useChatStore();
  const { onlineUsers } = useAuthStore();

  const typingIds = typingInSelected();
  const [showDetails, setShowDetails] = useState(false);
  const [showWallpaper, setShowWallpaper] = useState(false);

  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === "Escape") closeConversation();
    };
    window.addEventListener("keydown", handleEscKey);
    return () => window.removeEventListener("keydown", handleEscKey);
  }, [closeConversation]);

  if (!selectedConversation) return null;

  const isGroup = selectedConversation.type === "group";
  const partner = selectedConversation.partner;
  const isOnline = !isGroup && onlineUsers.includes(partner?._id);
  const typing = typingLabel(selectedConversation, typingIds);

  const title = isGroup
    ? selectedConversation.name || "Unnamed group"
    : partner?.name ?? "Unknown";

  let subtitle;
  if (isGroup) subtitle = `${selectedConversation.participants?.length ?? 0} members`;
  else subtitle = isOnline ? "Online" : "Offline";

  return (
    <div className="glass-plain flex h-[84px] shrink-0 items-center justify-between gap-2 border-b border-line/10 px-4 sm:px-6">
      <div className="flex min-w-0 items-center space-x-3">
        {/* on a phone this pane replaces the list, so it needs a way back */}
        <button
          type="button"
          aria-label="Back to conversations"
          className="icon-btn md:hidden"
          onClick={closeConversation}
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>

        <Avatar
          src={isGroup ? selectedConversation.image : partner?.profilePic}
          name={title}
          size="lg"
          isGroup={isGroup}
          presence={isGroup ? null : isOnline}
        />

        <div className="min-w-0">
          <h3 className="truncate font-medium text-ink">{title}</h3>
          {/* aria-live so the state change is announced rather than only seen */}
          <p className="truncate text-sm text-muted" aria-live="polite">
            {typing ? <span className="text-accent-soft">{typing}</span> : subtitle}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          label="Chat wallpaper"
          icon={ImageIcon}
          onClick={() => setShowWallpaper(true)}
        />
        {isGroup && (
          <IconButton
            label="Group details"
            icon={InfoIcon}
            onClick={() => setShowDetails(true)}
          />
        )}
        <button
          type="button"
          aria-label="Close conversation"
          className="icon-btn hidden md:block"
          onClick={closeConversation}
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {showDetails && (
        <GroupDetailsPanel
          conversation={selectedConversation}
          onClose={() => setShowDetails(false)}
        />
      )}
      {showWallpaper && (
        <WallpaperPicker
          conversation={selectedConversation}
          onClose={() => setShowWallpaper(false)}
        />
      )}
    </div>
  );
}
export default ChatHeader;
