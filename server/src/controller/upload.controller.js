import cloudinary from "../lib/cloudinary.js";
import { env_variable } from "../lib/env.js";

/**
 * MED-01 — signed direct upload (DEC-07).
 *
 * The old path inlined a base64 data URI into a JSON body capped at 5 MB and
 * forwarded it to Cloudinary. That cannot carry voice notes, video or arbitrary
 * files, it makes upload progress impossible because the browser sees one
 * opaque POST, and every byte transits the API server.
 *
 * Here the server only issues a signature. The browser uploads straight to
 * Cloudinary and reports back what came out.
 *
 * The signature is the security boundary, so it is deliberately narrow:
 *
 *   - the folder is fixed by the server, never taken from the request
 *   - the timestamp bounds its life to Cloudinary's signature window
 *   - the resource type is chosen from a fixed set, not passed through
 *
 * Anything the client could otherwise choose — a public_id that overwrites
 * someone else's asset, a folder outside the app — is simply not signed.
 */

// Cloudinary treats each of these differently on ingest; "raw" is anything it
// should store without trying to transcode.
const RESOURCE_TYPES = {
  image: "image",
  video: "video",
  // audio rides Cloudinary's video pipeline, which is where its duration and
  // transcoding support live
  audio: "video",
  file: "raw",
};

const FOLDERS = {
  image: "chatify/images",
  video: "chatify/videos",
  audio: "chatify/voice",
  file: "chatify/files",
};

// Bounds live here as well as in the upload preset, so an oversized file is
// refused before it is uploaded rather than after.
export const MAX_BYTES = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

export const createUploadSignature = async (req, res) => {
  try {
    const { kind, bytes } = req.body;

    if (!Object.hasOwn(RESOURCE_TYPES, kind)) {
      return res.status(400).json({ message: "Unsupported upload type." });
    }
    if (typeof bytes !== "number" || bytes <= 0) {
      return res.status(400).json({ message: "A file size is required." });
    }
    if (bytes > MAX_BYTES[kind]) {
      return res.status(400).json({
        message: `That file is too large. The limit is ${Math.round(MAX_BYTES[kind] / 1024 / 1024)} MB.`,
      });
    }

    const timestamp = Math.round(Date.now() / 1000);
    // Only these parameters are signed, so only these are enforceable. Adding a
    // parameter to the upload call without adding it here makes the signature
    // invalid, which is the failure mode we want.
    const paramsToSign = { timestamp, folder: FOLDERS[kind] };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      env_variable.CLOUDINARY_API_SECRET
    );

    res.status(200).json({
      signature,
      timestamp,
      folder: FOLDERS[kind],
      resourceType: RESOURCE_TYPES[kind],
      apiKey: env_variable.CLOUDINARY_API_KEY,
      cloudName: env_variable.CLOUDINARY_CLOUD_NAME,
      maxBytes: MAX_BYTES[kind],
    });
  } catch (error) {
    console.error("Error in createUploadSignature: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
