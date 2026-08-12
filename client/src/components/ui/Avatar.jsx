import { UsersIcon } from "lucide-react";

const SIZES = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-20",
};

/**
 * Avatar with an optional presence dot.
 *
 * Replaces daisyUI's `avatar` + `online`/`offline` (DEC-13). That dot was a
 * pseudo-element coloured by daisyUI's `--su`, which meant it could not be
 * themed from a Tailwind class and was the one green in an otherwise cyan UI.
 * It also followed `prefers-color-scheme` independently of the app, which is
 * how the light/dark leak showed up.
 *
 * `presence` is deliberately tri-state: `null` means "not a presence context"
 * (a group, a list of contacts you have no relationship with), which is
 * different from "offline".
 */
function Avatar({ src, name = "", size = "md", presence = null, isGroup = false }) {
  return (
    <span className={`relative inline-block shrink-0 ${SIZES[size]}`}>
      <span className="block h-full w-full overflow-hidden rounded-full bg-raised/60 ring-1 ring-line/15">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : isGroup ? (
          <UsersIcon className="m-auto h-1/2 w-1/2 translate-y-1/2 text-muted" />
        ) : (
          <img src="/avatar.png" alt="" className="h-full w-full object-cover" />
        )}
      </span>

      {presence !== null && (
        <>
          <span
            className={`absolute bottom-0 right-0 block size-3 rounded-full ring-2 ring-surface ${
              presence ? "bg-success" : "bg-line/50"
            }`}
          />
          {/* presence is conveyed by colour alone otherwise */}
          <span className="sr-only">{presence ? `${name} is online` : `${name} is offline`}</span>
        </>
      )}
    </span>
  );
}

export default Avatar;
