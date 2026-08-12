import { useEffect, useState } from "react";
import { UsersIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";

import BorderAnimatedContainer from "../components/BorderAnimatedContainer";
import ProfileHeader from "../components/ProfileHeader";
import ActiveTabSwitch from "../components/ActiveTabSwitch";
import ChatsList from "../components/ChatsList";
import MessageSearch from "../components/MessageSearch";
import NewGroupDialog from "../components/NewGroupDialog";
import ContactList from "../components/ContactList";
import ChatContainer from "../components/ChatContainer";
import NoConversationPlaceholder from "../components/NoConversationPlaceholder";

function ChatPage() {
  const { activeTab, selectedConversation, subscribeToInbox, unsubscribeFromInbox } =
    useChatStore();
  const { socket } = useAuthStore();
  const [showNewGroup, setShowNewGroup] = useState(false);

  // One inbox listener for the whole authenticated session. Unread badges have
  // to update for conversations that are not open, which the old per-
  // conversation subscription in ChatContainer could not do. Keyed on the socket
  // instance so a logout/login cycle re-subscribes to the new one.
  useEffect(() => {
    if (!socket) return;

    subscribeToInbox();
    return () => unsubscribeFromInbox();
  }, [socket, subscribeToInbox, unsubscribeFromInbox]);

  return (
    // Full-bleed and full-height on phones; a fixed card once there is room for
    // both panes side by side. dvh rather than vh so mobile browser chrome does
    // not push the composer off-screen.
    <div className="relative w-full max-w-6xl h-[100dvh] sm:h-[calc(100dvh-2rem)] md:h-[800px] md:max-h-[calc(100dvh-2rem)]">
      <BorderAnimatedContainer>
        {/* LEFT SIDE — the only pane on a phone until a conversation is opened */}
        <div
          className={`w-full md:w-80 md:shrink-0 bg-slate-800/50 backdrop-blur-sm flex-col ${
            selectedConversation ? "hidden md:flex" : "flex"
          }`}
        >
          <ProfileHeader />
          <ActiveTabSwitch />
          {activeTab === "chats" && <MessageSearch />}
          {activeTab === "chats" && (
            <button
              type="button"
              onClick={() => setShowNewGroup(true)}
              className="mx-4 mb-2 flex items-center justify-center gap-2 rounded-lg border border-slate-700/60 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              <UsersIcon className="w-4 h-4" /> New group
            </button>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {activeTab === "chats" ? <ChatsList /> : <ContactList />}
          </div>
        </div>

        {/* RIGHT SIDE — takes over the screen on a phone once a chat is open.
            min-w-0 lets long names truncate instead of stretching the pane. */}
        <div
          className={`flex-1 min-w-0 flex-col bg-slate-900/50 backdrop-blur-sm ${
            selectedConversation ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedConversation ? <ChatContainer /> : <NoConversationPlaceholder />}
        </div>
      </BorderAnimatedContainer>

      {showNewGroup && <NewGroupDialog onClose={() => setShowNewGroup(false)} />}
    </div>
  );
}
export default ChatPage;
