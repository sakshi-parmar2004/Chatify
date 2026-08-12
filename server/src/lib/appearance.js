/**
 * The appearance vocabulary, mirrored from client/src/lib/themes.js and
 * client/src/lib/wallpapers.js.
 *
 * Deliberately duplicated rather than shared. A build-time import across the
 * two workspaces would couple the API's validation to the client bundle, and
 * the server has to reject an unknown theme whatever a client claims to
 * support. The lists are short and change together; a test asserts they agree.
 */
export const THEME_IDS = ["midnight", "abyss", "aurora", "ember", "daylight", "parchment"];
export const DEFAULT_THEME = "midnight";

export const WALLPAPER_PRESET_IDS = ["none", "mesh", "dusk", "grid", "dots", "aurora"];

/** Only our own asset host, so a "wallpaper" cannot become an arbitrary URL. */
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\//;

/**
 * @returns { ok: true, value } | { ok: false, message }
 *
 * `null` clears the wallpaper. A preset and a URL are mutually exclusive —
 * accepting both would leave the render order to decide which wins.
 */
export const validateWallpaper = (wallpaper) => {
  if (wallpaper === null || wallpaper === undefined) {
    return { ok: true, value: { preset: null, url: null } };
  }
  if (typeof wallpaper !== "object") {
    return { ok: false, message: "Invalid wallpaper." };
  }

  const { preset = null, url = null } = wallpaper;

  if (preset !== null && !WALLPAPER_PRESET_IDS.includes(preset)) {
    return { ok: false, message: "Unknown wallpaper." };
  }
  if (url !== null) {
    if (typeof url !== "string" || !CLOUDINARY_URL.test(url)) {
      return { ok: false, message: "A wallpaper image must be an uploaded file." };
    }
    return { ok: true, value: { preset: null, url } };
  }

  return { ok: true, value: { preset, url: null } };
};
