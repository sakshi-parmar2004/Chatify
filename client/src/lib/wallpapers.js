/**
 * Wallpaper presets (UIX-04).
 *
 * CSS only — gradients and an SVG noise data URI. No storage, no upload, no
 * moderation question, and they follow the active theme because they are built
 * from the same custom properties.
 *
 * `none` is first and is the default: a wallpaper is opt-in, because the
 * glassmorphism already gives the conversation a background worth looking at.
 */
export const WALLPAPER_PRESETS = [
  { id: "none", name: "None", css: null },
  {
    id: "mesh",
    name: "Mesh",
    css:
      "radial-gradient(at 18% 22%, rgb(var(--glow-a) / 0.28) 0px, transparent 55%)," +
      "radial-gradient(at 82% 12%, rgb(var(--accent) / 0.22) 0px, transparent 50%)," +
      "radial-gradient(at 62% 88%, rgb(var(--glow-b) / 0.24) 0px, transparent 55%)",
  },
  {
    id: "dusk",
    name: "Dusk",
    css:
      "linear-gradient(160deg, rgb(var(--glow-a) / 0.18), transparent 45%)," +
      "linear-gradient(20deg, rgb(var(--accent) / 0.2), transparent 55%)",
  },
  {
    id: "grid",
    name: "Grid",
    css:
      "linear-gradient(to right, rgb(var(--line) / 0.09) 1px, transparent 1px)," +
      "linear-gradient(to bottom, rgb(var(--line) / 0.09) 1px, transparent 1px)",
    size: "28px 28px",
  },
  {
    id: "dots",
    name: "Dots",
    css: "radial-gradient(rgb(var(--line) / 0.16) 1px, transparent 1px)",
    size: "22px 22px",
  },
  {
    id: "aurora",
    name: "Aurora",
    css:
      "conic-gradient(from 210deg at 30% 20%, rgb(var(--accent) / 0.22), transparent 40%)," +
      "conic-gradient(from 30deg at 75% 75%, rgb(var(--glow-b) / 0.2), transparent 45%)",
  },
];

export const presetById = (id) =>
  WALLPAPER_PRESETS.find((preset) => preset.id === id) ?? WALLPAPER_PRESETS[0];

export const PRESET_IDS = WALLPAPER_PRESETS.map((preset) => preset.id);

/**
 * Resolve the wallpaper for a conversation: its own setting first, then the
 * account default, then nothing.
 */
export const resolveWallpaper = (conversation, globalDefault) =>
  conversation?.wallpaper ?? globalDefault ?? null;

/** Inline style for the wallpaper layer. A custom upload beats a preset. */
export const wallpaperStyle = (wallpaper) => {
  if (!wallpaper) return null;

  if (wallpaper.url) {
    return { backgroundImage: `url(${CSS.escape(wallpaper.url)})`, backgroundSize: "cover" };
  }

  const preset = presetById(wallpaper.preset);
  if (!preset.css) return null;

  return {
    backgroundImage: preset.css,
    backgroundSize: preset.size ?? "cover",
    backgroundRepeat: preset.size ? "repeat" : "no-repeat",
  };
};
