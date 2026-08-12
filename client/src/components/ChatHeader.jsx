import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useEffect } from "react";
import { useAuthStore } from "../store/useAuthStore";

function ChatHeader() {
  const { selectedUser, setSelectedUser } = useChatStore();
  const { onlineUsers } = useAuthStore();
  const isOnline = onlineUsers.includes(selectedUser._id);

  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === "Escape") setSelectedUser(null);
    };

    window.addEventListener("keydown", handleEscKey);

    // cleanup function
    return () => window.removeEventListener("keydown", handleEscKey);
  }, [setSelectedUser]);

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
          onClick={() => setSelectedUser(null)}
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>

        <div className={`avatar shrink-0 ${isOnline ? "online" : "offline"}`}>
          <div className="w-10 sm:w-12 rounded-full">
            <img src={selectedUser.profilePic || "/avatar.png"} alt="" />
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-slate-200 font-medium truncate">{selectedUser.name}</h3>
          <p className="text-slate-400 text-sm">{isOnline ? "Online" : "Offline"}</p>
        </div>
      </div>

      {/* the back arrow covers this on small screens */}
      <button
        type="button"
        aria-label="Close conversation"
        className="hidden md:block shrink-0"
        onClick={() => setSelectedUser(null)}
      >
        <XIcon className="w-5 h-5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" />
      </button>
    </div>
  );
}
export default ChatHeader;
