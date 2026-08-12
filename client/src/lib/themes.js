/**
 * The theme registry (UIX-03).
 *
 * `id` must match a `[data-theme="…"]` block in styles/themes.css, and the same
 * list is enumerated server-side so an unknown value cannot be persisted. The
 * swatch is only for the picker — the real colours live in CSS, and duplicating
 * them here would guarantee they drift.
 */
export const THEMES = [
  {
    id: "midnight",
    name: "Midnight",
    scheme: "dark",
    swatch: ["#020617", "#0f172a", "#06b6d4"],
  },
  {
    id: "abyss",
    name: "Abyss",
    scheme: "dark",
    swatch: ["#09090b", "#18181b", "#8b5cf6"],
  },
  {
    id: "aurora",
    name: "Aurora",
    scheme: "dark",
    swatch: ["#031216", "#07262c", "#10b981"],
  },
  {
    id: "ember",
    name: "Ember",
    scheme: "dark",
    swatch: ["#18100c", "#2b1d15", "#f59e0b"],
  },
  {
    id: "daylight",
    name: "Daylight",
    scheme: "light",
    swatch: ["#e2e8f0", "#ffffff", "#4f46e5"],
  },
  {
    id: "parchment",
    name: "Parchment",
    scheme: "light",
    swatch: ["#f0e8da", "#fffcf6", "#b44e28"],
  },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);
export const DEFAULT_THEME = "midnight";

export const THEME_STORAGE_KEY = "chatify-theme";
export const TRANSPARENCY_STORAGE_KEY = "chatify-reduce-transparency";

export const isValidTheme = (id) => THEME_IDS.includes(id);

/**
 * Write the theme to the document.
 *
 * Also sets `color-scheme`, which is what makes the browser's own surfaces —
 * form controls, the scrollbar gutter, the space beyond the scroll boundary —
 * follow the theme. Without it a light theme keeps a dark scrollbar.
 */
export const applyTheme = (themeId, { reduceTransparency = false } = {}) => {
  const id = isValidTheme(themeId) ? themeId : DEFAULT_THEME;
  const theme = THEMES.find((entry) => entry.id === id);

  document.documentElement.dataset.theme = id;
  document.documentElement.style.colorScheme = theme.scheme;

  if (reduceTransparency) {
    document.documentElement.dataset.transparency = "reduce";
  } else {
    delete document.documentElement.dataset.transparency;
  }
};
