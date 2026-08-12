import { useEffect, useState } from "react";
import { ImageIcon, LogOutIcon, ShieldIcon, UserMinusIcon, UserPlusIcon, XIcon } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-slate-100 font-medium flex-1">Group details</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <XIcon className="w-5 h-5 text-slate-400 hover:text-slate-200" />
          </button>
        </div>

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
              className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 px-3 text-slate-200"
            />
            <button type="submit" className="text-sm text-cyan-400 hover:text-cyan-300 px-2">
              Save
            </button>
          </form>
        ) : (
          <p className="text-slate-200 mb-5">{conversation.name}</p>
        )}

        <h3 className="text-xs text-slate-400 mb-2">
          {conversation.participants.length} members
        </h3>
        <ul className="space-y-1 mb-5">
          {conversation.participants.map((member) => {
            const isMemberAdmin = admins.includes(member._id);
            const isMe = member._id === authUser._id;

            return (
              <li key={member._id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/40">
                <img src={member.profilePic || "/avatar.png"} alt="" className="size-8 rounded-full" />
                <span className="text-sm text-slate-200 truncate flex-1">
                  {member.name}
                  {isMe && <span className="text-slate-500"> (you)</span>}
                </span>

                {isMemberAdmin && (
                  <span className="text-[10px] uppercase tracking-wide text-cyan-400">Admin</span>
                )}

                {iAmAdmin && !isMe && (
                  <>
                    <button
                      type="button"
                      aria-label={isMemberAdmin ? `Demote ${member.name}` : `Promote ${member.name}`}
                      onClick={() => setAdmin(conversation._id, member._id, !isMemberAdmin)}
                      className={isMemberAdmin ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}
                    >
                      <ShieldIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => removeParticipant(conversation._id, member._id)}
                      className="text-slate-500 hover:text-rose-400"
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
              className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"
            >
              <UserPlusIcon className="w-4 h-4" /> Add people
            </button>

            {isAdding && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {addable.length === 0 && (
                  <p className="text-sm text-slate-500">Everyone you know is already here.</p>
                )}
                {addable.map((contact) => (
                  <button
                    key={contact._id}
                    type="button"
                    onClick={() => addParticipants(conversation._id, [contact._id])}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 text-left"
                  >
                    <img
                      src={contact.profilePic || "/avatar.png"}
                      alt=""
                      className="size-8 rounded-full"
                    />
                    <span className="text-sm text-slate-200 truncate">{contact.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <h3 className="text-xs text-slate-400 mb-2 flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" /> Shared media
        </h3>
        {media.length === 0 ? (
          <p className="text-sm text-slate-500 mb-5">Nothing shared yet.</p>
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
                  className="aspect-square rounded overflow-hidden bg-slate-800 flex items-center justify-center"
                >
                  {isImage ? (
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[9px] text-slate-400 px-1 text-center break-all line-clamp-3">
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
          className="flex items-center gap-2 text-sm text-rose-400 hover:text-rose-300"
        >
          <LogOutIcon className="w-4 h-4" /> Leave group
        </button>
      </div>
    </div>
  );
}

export default GroupDetailsPanel;
