import { useEffect, useState } from "react";
import { ArrowLeftIcon, XIcon, UsersIcon, InfoIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import GroupDetailsPanel from "./GroupDetailsPanel";

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

  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === "Escape") closeConversation();
    };

    window.addEventListener("keydown", handleEscKey);

    // cleanup function
    return () => window.removeEventListener("keydown", handleEscKey);
  }, [closeConversation]);

  if (!selectedConversation) return null;

  const isGroup = selectedConversation.type === "group";
  const partner = selectedConversation.partner;
  const isOnline = !isGroup && onlineUsers.includes(partner?._id);
  const typing = typingLabel(selectedConversation, typingIds);

  const title = isGroup
    ? (selectedConversation.name || "Unnamed group")
    : (partner?.name ?? "Unknown");

  const subtitle = isGroup
    ? `${selectedConversation.participants?.length ?? 0} members`
    : isOnline
      ? "Online"
      : "Offline";

  return (
    <div
      className="flex justify-between items-center gap-2 bg-slate-800/50 border-b
   border-slate-700/50 h-[84px] shrink-0 px-4 sm:px-6"
    >
      <div className="flex items-center space-x-3 min-w-0">
        {/* on a phone this pane replaces the list, so it needs a way back */}
        <button
          type="button"
          aria-label="Back to conversations"
          className="md:hidden shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
          onClick={closeConversation}
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>

        <div className={`avatar shrink-0 ${isGroup ? "" : isOnline ? "online" : "offline"}`}>
          <div className="w-10 sm:w-12 rounded-full bg-slate-700 flex items-center justify-center">
            {isGroup ? (
              selectedConversation.image ? (
                <img src={selectedConversation.image} alt="" />
              ) : (
                <UsersIcon className="w-5 h-5 text-slate-300 m-auto" />
              )
            ) : (
              <img src={partner?.profilePic || "/avatar.png"} alt="" />
            )}
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-slate-200 font-medium truncate">{title}</h3>
          {/* aria-live so the state change is announced rather than only seen */}
          <p className="text-slate-400 text-sm truncate" aria-live="polite">
            {typing ? <span className="text-cyan-400">{typing}</span> : subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {isGroup && (
          <button
            type="button"
            aria-label="Group details"
            onClick={() => setShowDetails(true)}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <InfoIcon className="w-5 h-5" />
          </button>
        )}

        {/* the back arrow covers this on small screens */}
        <button
          type="button"
          aria-label="Close conversation"
          className="hidden md:block"
          onClick={closeConversation}
        >
          <XIcon className="w-5 h-5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" />
        </button>
      </div>

      {showDetails && (
        <GroupDetailsPanel
          conversation={selectedConversation}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
}
export default ChatHeader;
