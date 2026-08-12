import { useEffect, useState } from "react";
import { UsersIcon, XIcon } from "lucide-react";
import { useChatStore } from "../store/useChatStore";

/** GRP-01 — create a group from the contact list. */
function NewGroupDialog({ onClose }) {
  const { allContacts, getAllContacts, createGroup } = useChatStore();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    getAllContacts();
  }, [getAllContacts]);

  useEffect(() => {
    const handleEscKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleEscKey);
    return () => window.removeEventListener("keydown", handleEscKey);
  }, [onClose]);

  const toggle = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim() || selected.length === 0 || isCreating) return;

    setIsCreating(true);
    const created = await createGroup({ name: name.trim(), participantIds: selected });
    setIsCreating(false);
    if (created) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <UsersIcon className="w-5 h-5 text-cyan-400" />
          <h2 className="text-slate-100 font-medium flex-1">New group</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <XIcon className="w-5 h-5 text-slate-400 hover:text-slate-200" />
          </button>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="group-name" className="block text-xs text-slate-400 mb-1">
            Group name
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 px-3 text-slate-200 mb-4"
          />

          <p className="text-xs text-slate-400 mb-1">
            Members ({selected.length} selected)
          </p>
          <div className="max-h-56 overflow-y-auto space-y-1 mb-4">
            {allContacts.length === 0 && (
              <p className="text-sm text-slate-500 py-2">
                Nobody to add yet — other people who sign up will show up here.
              </p>
            )}
            {allContacts.map((contact) => (
              <label
                key={contact._id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(contact._id)}
                  onChange={() => toggle(contact._id)}
                  className="accent-cyan-500"
                />
                <img
                  src={contact.profilePic || "/avatar.png"}
                  alt=""
                  className="size-8 rounded-full"
                />
                <span className="text-sm text-slate-200 truncate">{contact.name}</span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            disabled={!name.trim() || selected.length === 0 || isCreating}
            className="w-full bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? "Creating…" : "Create group"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default NewGroupDialog;
