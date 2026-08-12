import { useEffect } from "react";
import { MessageCircleIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import UsersLoadingSkeleton from "./UsersLoadingSkeleton";
import { useAuthStore } from "../store/useAuthStore";

function ContactList() {
  const { getAllContacts, allContacts, setSelectedUser, isUsersLoading } = useChatStore();
  const { onlineUsers } = useAuthStore();

  useEffect(() => {
    getAllContacts();
  }, [getAllContacts]);

  if (isUsersLoading) return <UsersLoadingSkeleton />;

  if (allContacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
        <div className="w-16 h-16 bg-cyan-500/10 rounded-full flex items-center justify-center">
          <MessageCircleIcon className="w-8 h-8 text-cyan-400" />
        </div>
        <div>
          <h4 className="text-slate-200 font-medium mb-1">No contacts yet</h4>
          <p className="text-slate-400 text-sm px-6">
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
          className="w-full text-left bg-cyan-500/10 p-4 rounded-lg cursor-pointer hover:bg-cyan-500/20 transition-colors"
          onClick={() => setSelectedUser(contact)}
        >
          <div className="flex items-center gap-3">
            <div className={`avatar ${onlineUsers.includes(contact._id) ? "online" : "offline"}`}>
              <div className="size-12 rounded-full">
                <img src={contact.profilePic || "/avatar.png"} alt="" />
              </div>
            </div>
            <h4 className="text-slate-200 font-medium truncate">
              {contact.name}
              <span className="sr-only">
                {onlineUsers.includes(contact._id) ? " (online)" : " (offline)"}
              </span>
            </h4>
          </div>
        </button>
      ))}
    </>
  );
}
export default ContactList;
