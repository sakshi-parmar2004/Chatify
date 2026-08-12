import { axiosInstance } from "./axios";

/**
 * MED-01 / MED-02 — upload straight to Cloudinary against a server signature.
 *
 * XMLHttpRequest rather than fetch, deliberately: fetch still has no upload
 * progress event, and real progress is the whole point of MED-02. It also gives
 * us a genuine abort, so a cancelled upload stops transferring rather than
 * merely being ignored.
 */

export const kindForFile = (file) => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

/**
 * @returns { promise, abort } — the caller keeps `abort` so the UI can cancel.
 * The promise resolves to the attachment shape the API expects.
 */
export const uploadFile = (file, { onProgress } = {}) => {
  const request = new XMLHttpRequest();
  let aborted = false;

  const promise = (async () => {
    const kind = kindForFile(file);

    // the server decides the folder and enforces the size cap; a signature is
    // only issued for what it is willing to accept
    const { data: signature } = await axiosInstance.post("/conversations/uploads/sign", {
      kind,
      bytes: file.size,
    });

    if (aborted) throw new DOMException("Upload cancelled", "AbortError");

    const form = new FormData();
    form.append("file", file);
    form.append("api_key", signature.apiKey);
    form.append("timestamp", signature.timestamp);
    form.append("signature", signature.signature);
    // must match exactly what was signed, or Cloudinary rejects it
    form.append("folder", signature.folder);

    const endpoint = `https://api.cloudinary.com/v1_1/${signature.cloudName}/${signature.resourceType}/upload`;

    const uploaded = await new Promise((resolve, reject) => {
      request.open("POST", endpoint);

      request.upload.addEventListener("progress", (event) => {
        // lengthComputable is false for chunked bodies; a fake percentage is
        // worse than none
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 300) {
          resolve(JSON.parse(request.responseText));
        } else {
          reject(new Error("Upload failed"));
        }
      });
      request.addEventListener("error", () => reject(new Error("Upload failed")));
      request.addEventListener("abort", () =>
        reject(new DOMException("Upload cancelled", "AbortError"))
      );

      request.send(form);
    });

    return {
      kind,
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      name: file.name,
      bytes: uploaded.bytes ?? file.size,
      mimeType: file.type,
      durationSeconds: uploaded.duration ?? null,
      width: uploaded.width ?? null,
      height: uploaded.height ?? null,
    };
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      request.abort();
    },
  };
};
