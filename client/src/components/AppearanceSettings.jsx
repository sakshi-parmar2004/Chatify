import { PaletteIcon } from "lucide-react";
import Modal from "./ui/Modal";
import { useThemeStore } from "../store/useThemeStore";
import { THEMES } from "../lib/themes";

/** UIX-03 — theme picker and the transparency escape hatch. */
function AppearanceSettings({ onClose }) {
  const { theme, setTheme, reduceTransparency, setReduceTransparency } = useThemeStore();

  return (
    <Modal title="Appearance" icon={PaletteIcon} onClose={onClose}>
      <fieldset>
        <legend className="mb-2 text-xs text-muted">Theme</legend>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((entry) => {
            const isActive = entry.id === theme;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setTheme(entry.id)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  isActive
                    ? "border-accent/60 bg-accent/10"
                    : "border-line/15 hover:border-line/30"
                }`}
              >
                {/* the swatch is illustrative only — the real values live in CSS,
                    and duplicating them here would guarantee they drift */}
                <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                  {entry.swatch.map((colour) => (
                    <span
                      key={colour}
                      className="size-4 rounded-full ring-1 ring-line/20"
                      style={{ backgroundColor: colour }}
                    />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{entry.name}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-faint">
                    {entry.scheme}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={reduceTransparency}
          onChange={(event) => setReduceTransparency(event.target.checked)}
          className="mt-1 accent-[rgb(var(--accent))]"
        />
        <span className="text-sm text-ink">
          Reduce transparency
          <span className="block text-xs text-faint">
            Makes every panel solid. Your system setting is honoured automatically; this is
            here for when you want it without changing that.
          </span>
        </span>
      </label>
    </Modal>
  );
}

export default AppearanceSettings;
