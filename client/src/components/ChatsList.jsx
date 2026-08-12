import { useEffect } from "react";
import { useChatStore } from "../store/useChatStore";
import UsersLoadingSkeleton from "./UsersLoadingSkeleton";
import NoChatsFound from "./NoChatsFound";
import { useAuthStore } from "../store/useAuthStore";

function ChatsList() {
  const { getMyChatPartners, chats, isUsersLoading, setSelectedUser, unreadCounts } =
    useChatStore();
  const { onlineUsers } = useAuthStore();

  useEffect(() => {
    getMyChatPartners();
  }, [getMyChatPartners]);

  if (isUsersLoading) return <UsersLoadingSkeleton />;
  if (chats.length === 0) return <NoChatsFound />;

  return (
    <>
      {chats.map((chat) => {
        const unread = unreadCounts[chat._id] ?? 0;

        return (
          <button
            key={chat._id}
            type="button"
            className="w-full text-left bg-cyan-500/10 p-4 rounded-lg cursor-pointer hover:bg-cyan-500/20 transition-colors"
            onClick={() => setSelectedUser(chat)}
          >
            <div className="flex items-center gap-3">
              <div className={`avatar shrink-0 ${onlineUsers.includes(chat._id) ? "online" : "offline"}`}>
                <div className="size-12 rounded-full">
                  <img src={chat.profilePic || "/avatar.png"} alt="" />
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
                  {chat.name}
                  <span className="sr-only">
                    {onlineUsers.includes(chat._id) ? " (online)" : " (offline)"}
                  </span>
                </h4>
                {chat.lastMessage && (
                  <p className="text-xs text-slate-400 truncate">
                    {chat.lastMessage.text || "Photo"}
                  </p>
                )}
              </div>
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
