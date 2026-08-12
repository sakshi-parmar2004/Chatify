import { useEffect, useState } from "react";
import { UsersIcon } from "lucide-react";
import Modal from "./ui/Modal";
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
    <Modal title="New group" icon={UsersIcon} onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="group-name" className="mb-1 block text-xs text-muted">
          Group name
        </label>
        <input
          id="group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          className="field mb-4"
        />

        <p className="mb-1 text-xs text-muted">Members ({selected.length} selected)</p>
        <div className="mb-4 max-h-56 space-y-1 overflow-y-auto">
          {allContacts.length === 0 && (
            <p className="py-2 text-sm text-faint">
              Nobody to add yet — other people who sign up will show up here.
            </p>
          )}
          {allContacts.map((contact) => (
            <label
              key={contact._id}
              className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-line/10"
            >
              <input
                type="checkbox"
                checked={selected.includes(contact._id)}
                onChange={() => toggle(contact._id)}
                className="accent-[rgb(var(--accent))]"
              />
              <img src={contact.profilePic || "/avatar.png"} alt="" className="size-8 rounded-full" />
              <span className="truncate text-sm text-ink">{contact.name}</span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={!name.trim() || selected.length === 0 || isCreating}
          className="btn-primary w-full"
        >
          {isCreating ? "Creating…" : "Create group"}
        </button>
      </form>
    </Modal>
  );
}

export default NewGroupDialog;
