import { useEffect, useRef } from "react";
import { XIcon } from "lucide-react";

/**
 * The single dialog shell.
 *
 * Replaces three byte-identical copies (NewGroupDialog, GroupDetailsPanel,
 * NotificationSettings). Beyond removing the duplication it adds the three
 * things all three copies were missing: Escape to close, a click-outside
 * target, and focus moved into the dialog so a keyboard user is not left
 * behind on the page underneath.
 */
function Modal({ title, icon: Icon, onClose, children, maxWidth = "max-w-md" }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);

    // without this the focus ring stays on whatever opened the dialog
    panelRef.current?.focus();

    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgb(var(--bg) / 0.72)", backdropFilter: "blur(4px)" }}
      // the scrim closes; clicks inside the panel must not bubble out to it
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`glass-raised w-full ${maxWidth} max-h-[85vh] overflow-y-auto rounded-2xl p-5 outline-none`}
      >
        <div className="mb-4 flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-accent-soft" />}
          <h2 className="flex-1 font-medium text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="icon-btn">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
