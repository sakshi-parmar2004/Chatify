import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { ImageIcon, LogOutIcon, ShieldIcon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";

/** GRP-02, GRP-03 and MED-07 — everything about the open group in one panel. */
function GroupDetailsPanel({ conversation, onClose }) {
  const {
    renameGroup,
    addParticipants,
    removeParticipant,
    setAdmin,
    allContacts,
    getAllContacts,
    getConversationMedia,
  } = useChatStore();
  const { authUser } = useAuthStore();

  const [name, setName] = useState(conversation.name ?? "");
  const [isAdding, setIsAdding] = useState(false);
  const [media, setMedia] = useState([]);

  const admins = (conversation.admins ?? []).map(String);
  const iAmAdmin = admins.includes(authUser._id);

  useEffect(() => {
    getAllContacts();
  }, [getAllContacts]);

  useEffect(() => {
    let cancelled = false;
    getConversationMedia(conversation._id).then((result) => {
      if (!cancelled) setMedia(result.items);
    });
    return () => {
      cancelled = true;
    };
  }, [conversation._id, getConversationMedia]);

  const memberIds = new Set(conversation.participants.map((p) => p._id));
  const addable = allContacts.filter((contact) => !memberIds.has(contact._id));

  return (
    <Modal title="Group details" onClose={onClose} maxWidth="max-w-md">

        {iAmAdmin ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && name.trim() !== conversation.name) {
                renameGroup(conversation._id, name.trim());
              }
            }}
            className="flex gap-2 mb-5"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Group name"
              maxLength={80}
              className="field flex-1"
            />
            <button type="submit" className="text-sm text-accent-soft hover:text-accent-soft px-2">
              Save
            </button>
          </form>
        ) : (
          <p className="text-ink mb-5">{conversation.name}</p>
        )}

        <h3 className="text-xs text-muted mb-2">
          {conversation.participants.length} members
        </h3>
        <ul className="space-y-1 mb-5">
          {conversation.participants.map((member) => {
            const isMemberAdmin = admins.includes(member._id);
            const isMe = member._id === authUser._id;

            return (
              <li key={member._id} className="flex items-center gap-3 p-2 rounded-lg bg-raised/40">
                <img src={member.profilePic || "/avatar.png"} alt="" className="size-8 rounded-full" />
                <span className="text-sm text-ink truncate flex-1">
                  {member.name}
                  {isMe && <span className="text-faint"> (you)</span>}
                </span>

                {isMemberAdmin && (
                  <span className="text-[10px] uppercase tracking-wide text-accent-soft">Admin</span>
                )}

                {iAmAdmin && !isMe && (
                  <>
                    <button
                      type="button"
                      aria-label={isMemberAdmin ? `Demote ${member.name}` : `Promote ${member.name}`}
                      onClick={() => setAdmin(conversation._id, member._id, !isMemberAdmin)}
                      className={isMemberAdmin ? "text-accent-soft" : "text-faint hover:text-ink/90"}
                    >
                      <ShieldIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => removeParticipant(conversation._id, member._id)}
                      className="text-faint hover:text-danger"
                    >
                      <UserMinusIcon className="w-4 h-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        {iAmAdmin && (
          <div className="mb-5">
            <button
              type="button"
              onClick={() => setIsAdding((open) => !open)}
              className="flex items-center gap-2 text-sm text-accent-soft hover:text-accent"
            >
              <UserPlusIcon className="w-4 h-4" /> Add people
            </button>

            {isAdding && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {addable.length === 0 && (
                  <p className="text-sm text-faint">Everyone you know is already here.</p>
                )}
                {addable.map((contact) => (
                  <button
                    key={contact._id}
                    type="button"
                    onClick={() => addParticipants(conversation._id, [contact._id])}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-raised/60 text-left"
                  >
                    <img
                      src={contact.profilePic || "/avatar.png"}
                      alt=""
                      className="size-8 rounded-full"
                    />
                    <span className="text-sm text-ink truncate">{contact.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <h3 className="text-xs text-muted mb-2 flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" /> Shared media
        </h3>
        {media.length === 0 ? (
          <p className="text-sm text-faint mb-5">Nothing shared yet.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1 mb-5">
            {media.map((item) => {
              const url = item.attachment?.url ?? item.image;
              const isImage = !item.attachment || item.attachment.kind === "image";

              return (
                <a
                  key={item._id}
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="aspect-square rounded overflow-hidden bg-raised flex items-center justify-center"
                >
                  {isImage ? (
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[9px] text-muted px-1 text-center break-all line-clamp-3">
                      {item.attachment?.name || item.attachment?.kind}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            removeParticipant(conversation._id, authUser._id);
            onClose();
          }}
          className="flex items-center gap-2 text-sm text-danger transition-opacity hover:opacity-80"
        >
          <LogOutIcon className="w-4 h-4" /> Leave group
        </button>
    </Modal>
  );
}

export default GroupDetailsPanel;
