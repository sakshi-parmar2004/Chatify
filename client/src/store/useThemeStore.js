import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  TRANSPARENCY_STORAGE_KEY,
  applyTheme,
  isValidTheme,
} from "../lib/themes";

/**
 * Theme state (UIX-03).
 *
 * Two stores, one truth: localStorage is a *cache* that exists purely so the
 * inline script in index.html can paint the right theme before React loads;
 * the account is the source of truth and wins on reconciliation.
 *
 * The theme deliberately survives logout. It is as much a property of this
 * device and this pair of eyes as of the account, and resetting to Midnight
 * when someone signs out would be actively hostile to anyone who picked a light
 * theme for a reason.
 */
const readStored = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    // blocked cookies / private mode — a preference is not worth throwing over
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
};

const storedTheme = readStored(THEME_STORAGE_KEY, DEFAULT_THEME);

export const useThemeStore = create((set, get) => ({
  theme: isValidTheme(storedTheme) ? storedTheme : DEFAULT_THEME,
  reduceTransparency: readStored(TRANSPARENCY_STORAGE_KEY, "false") === "true",
  // global fallback wallpaper; a conversation may override it
  wallpaper: null,

  /**
   * Apply immediately, persist in the background.
   *
   * A theme switch that waits for a round trip feels broken, and the failure
   * mode of a lost write is mild — the choice is still applied on this device
   * and will re-sync on the next successful save.
   */
  setTheme: (theme) => {
    if (!isValidTheme(theme)) return;

    set({ theme });
    write(THEME_STORAGE_KEY, theme);
    applyTheme(theme, { reduceTransparency: get().reduceTransparency });

    axiosInstance.put("/preferences", { theme }).catch(() => {});
  },

  setReduceTransparency: (reduceTransparency) => {
    set({ reduceTransparency });
    write(TRANSPARENCY_STORAGE_KEY, reduceTransparency);
    applyTheme(get().theme, { reduceTransparency });

    axiosInstance.put("/preferences", { reduceTransparency }).catch(() => {});
  },

  setWallpaper: (wallpaper) => {
    set({ wallpaper });
    axiosInstance.put("/preferences", { wallpaper }).catch(() => {});
  },

  /**
   * Reconcile with the account once auth resolves.
   *
   * The account wins, so a theme chosen on a phone follows the user to a
   * laptop. Writing it back to localStorage is what keeps the next cold load
   * flash-free on this device.
   */
  syncFromAccount: (authUser) => {
    const preferences = authUser?.preferences;
    if (!preferences) return;

    const theme = isValidTheme(preferences.theme) ? preferences.theme : get().theme;
    const reduceTransparency = Boolean(preferences.reduceTransparency);

    set({ theme, reduceTransparency, wallpaper: preferences.wallpaper ?? null });
    write(THEME_STORAGE_KEY, theme);
    write(TRANSPARENCY_STORAGE_KEY, reduceTransparency);
    applyTheme(theme, { reduceTransparency });
  },
}));
