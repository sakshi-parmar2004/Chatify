import { MessageCircleIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";

function NoChatsFound() {
  const { setActiveTab } = useChatStore();

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
      <div className="size-16 rounded-full bg-accent/10 ring-1 ring-accent/20 flex items-center justify-center">
        <MessageCircleIcon className="w-8 h-8 text-accent-soft" />
      </div>
      <div>
        <h4 className="text-ink font-medium mb-1">No conversations yet</h4>
        <p className="text-muted text-sm px-6">
          Start a new chat by selecting a contact from the contacts tab
        </p>
      </div>
      <button
        onClick={() => setActiveTab("contacts")}
        className="px-4 py-2 text-sm text-accent-soft bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
      >
        Find contacts
      </button>
    </div>
  );
}
export default NoChatsFound;