import { MessageCircleIcon } from "lucide-react";

const NoConversationPlaceholder = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className="size-20 rounded-full bg-accent/10 ring-1 ring-accent/20 flex items-center justify-center mb-6">
        <MessageCircleIcon className="size-10 text-accent-soft" />
      </div>
      <h3 className="text-xl font-semibold text-ink mb-2">Select a conversation</h3>
      <p className="text-muted max-w-md">
        Choose a contact from the sidebar to start chatting or continue a previous conversation.
      </p>
    </div>
  );
};

export default NoConversationPlaceholder;