// Cloudinary's upload() also accepts remote URLs and fetches them server-side,
// so an unvalidated string is an SSRF vector. Only accept inline base64 images.
const DATA_URI_PREFIX = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB decoded

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export const validateImageDataUri = (value) => {
  if (typeof value !== "string") {
    return { ok: false, message: "Image must be a base64 data URI." };
  }

  if (!DATA_URI_PREFIX.test(value)) {
    return {
      ok: false,
      message: "Image must be a base64 data URI (png, jpg, webp, or gif).",
    };
  }

  const base64 = value.slice(value.indexOf(",") + 1);
  if (base64.length === 0) {
    return { ok: false, message: "Image data is empty." };
  }

  // base64 encodes 3 bytes per 4 characters, minus any padding
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;

  if (bytes > MAX_BYTES) {
    return { ok: false, message: "Image must be smaller than 3MB." };
  }

  return { ok: true };
};
