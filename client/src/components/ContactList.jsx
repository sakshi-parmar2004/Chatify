import { useEffect } from "react";
import { MessageCircleIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import UsersLoadingSkeleton from "./UsersLoadingSkeleton";
import Avatar from "./ui/Avatar";
import { useAuthStore } from "../store/useAuthStore";

function ContactList() {
  const { getAllContacts, allContacts, openDirectConversation, isUsersLoading } = useChatStore();
  const { onlineUsers } = useAuthStore();

  useEffect(() => {
    getAllContacts();
  }, [getAllContacts]);

  if (isUsersLoading) return <UsersLoadingSkeleton />;

  if (allContacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-accent/10">
          <MessageCircleIcon className="h-8 w-8 text-accent-soft" />
        </div>
        <div>
          <h4 className="mb-1 font-medium text-ink">No contacts yet</h4>
          <p className="px-6 text-sm text-muted">
            Other people who sign up will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {allContacts.map((contact) => (
        <button
          key={contact._id}
          type="button"
          className="w-full rounded-xl border border-transparent p-3 text-left transition-colors hover:border-line/10 hover:bg-line/[0.06]"
          // resolves (or creates) the direct thread, then opens it — a contact
          // is not itself a conversation
          onClick={() => openDirectConversation(contact._id)}
        >
          <div className="flex items-center gap-3">
            <Avatar
              src={contact.profilePic}
              name={contact.name}
              presence={onlineUsers.includes(contact._id)}
            />
            <h4 className="truncate font-medium text-ink">{contact.name}</h4>
          </div>
        </button>
      ))}
    </>
  );
}
export default ContactList;
