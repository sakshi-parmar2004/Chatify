import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImageIcon, UploadIcon } from "lucide-react";
import Modal from "./ui/Modal";
import { useChatStore } from "../store/useChatStore";
import { useThemeStore } from "../store/useThemeStore";
import { WALLPAPER_PRESETS, wallpaperStyle } from "../lib/wallpapers";
import { uploadFile } from "../lib/upload";

/**
 * UIX-04 — per-conversation wallpaper.
 *
 * Set for this conversation and for *you*: the same thread can look different
 * to each participant, which is why it lives in participantState server-side
 * rather than on the conversation itself.
 */
function WallpaperPicker({ conversation, onClose }) {
  const setConversationWallpaper = useChatStore((state) => state.setConversationWallpaper);
  const { wallpaper: globalWallpaper, setWallpaper: setGlobalWallpaper } = useThemeStore();
  const [isUploading, setIsUploading] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const fileRef = useRef(null);

  const current = conversation.wallpaper ?? globalWallpaper ?? { preset: "none" };

  const apply = (next) => {
    if (applyToAll) setGlobalWallpaper(next);
    else setConversationWallpaper(conversation._id, next);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image.");
      return;
    }

    setIsUploading(true);
    try {
      const attachment = await uploadFile(file).promise;
      apply({ url: attachment.url, preset: null });
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error(error?.response?.data?.message || "Could not upload that image");
      }
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Modal title="Chat wallpaper" icon={ImageIcon} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2">
        {WALLPAPER_PRESETS.map((preset) => {
          const isActive = !current.url && (current.preset ?? "none") === preset.id;
          const style = wallpaperStyle({ preset: preset.id });

          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => apply({ preset: preset.id, url: null })}
              className={`aspect-video overflow-hidden rounded-lg border transition-colors ${
                isActive ? "border-accent" : "border-line/15 hover:border-line/40"
              }`}
            >
              <span className="flex h-full w-full items-end bg-bg p-1" style={style ?? undefined}>
                <span className="text-[10px] text-muted">{preset.name}</span>
              </span>
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />

      <button
        type="button"
        disabled={isUploading}
        onClick={() => fileRef.current?.click()}
        className="btn-ghost mt-3 flex w-full items-center justify-center gap-2 text-sm disabled:opacity-50"
      >
        <UploadIcon className="h-4 w-4" />
        {isUploading ? "Uploading…" : "Upload your own"}
      </button>

      {current.url && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-line/15 p-2">
          <img src={current.url} alt="" className="h-12 w-20 rounded object-cover" />
          <span className="flex-1 text-xs text-muted">Custom image</span>
          <button
            type="button"
            onClick={() => apply({ preset: "none", url: null })}
            className="text-xs text-muted hover:text-danger"
          >
            Remove
          </button>
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={applyToAll}
          onChange={(event) => setApplyToAll(event.target.checked)}
          className="mt-1 accent-[rgb(var(--accent))]"
        />
        <span className="text-sm text-ink">
          Use for all conversations
          <span className="block text-xs text-faint">
            Sets your default. Conversations with their own wallpaper keep it.
          </span>
        </span>
      </label>

      <p className="mt-4 text-xs text-faint">
        Text stays readable over any image — a shade is drawn between the wallpaper and the
        messages, and it does not go lighter than the theme allows.
      </p>
    </Modal>
  );
}

export default WallpaperPicker;
