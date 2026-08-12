import dns from "node:dns/promises";
import net from "node:net";

/**
 * MSG-09 — resolve a link's Open Graph card.
 *
 * The dangerous part of unfurling is not the parsing, it is that the server
 * fetches a URL a user chose. Left open that is a server-side request forgery
 * primitive: an attacker sends themselves a message pointing at a cloud
 * metadata endpoint or an internal service and reads the result out of the
 * preview card.
 *
 * So the guards here matter more than the feature does:
 *
 *   - http and https only, no file:, no gopher:, no data:
 *   - the hostname is resolved and every address checked against private
 *     ranges *before* connecting
 *   - redirects are followed by hand so each hop is re-checked; a public URL
 *     that 302s to 169.254.169.254 is the whole attack
 *   - the response is size- and time-bounded
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

export const firstUrlIn = (text) => text?.match(URL_PATTERN)?.[0] ?? null;

/** Reject anything that is not a public unicast address. */
export const isBlockedAddress = (address) => {
  const version = net.isIP(address);
  if (version === 0) return true;

  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this network"
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  // IPv4-mapped IPv6 would otherwise bypass every check above
  if (normalized.startsWith("::ffff:")) return isBlockedAddress(normalized.slice(7));
  return false;
};

const assertPublicUrl = async (url) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  // A literal IP in the URL never reaches DNS, so check it directly too.
  if (net.isIP(url.hostname) && isBlockedAddress(url.hostname)) {
    throw new Error("Blocked address");
  }

  const records = await dns.lookup(url.hostname, { all: true });
  if (records.length === 0) throw new Error("Could not resolve host");
  if (records.some((record) => isBlockedAddress(record.address))) {
    throw new Error("Blocked address");
  }
};

const decode = (value = "") =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

const metaContent = (html, property) => {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i"
  );
  return decode(html.match(pattern)?.[1] ?? html.match(reversed)?.[1] ?? "");
};

/**
 * @returns a preview object, or null when the URL cannot be safely or usefully
 * unfurled. Callers degrade to a plain link — never surface the reason, since
 * "blocked address" tells a prober what they wanted to know.
 */
export const resolveLinkPreview = async (rawUrl, { fetchImpl = fetch } = {}) => {
  try {
    let url = new URL(rawUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // re-checked every hop: a public URL redirecting inward is the attack
      await assertPublicUrl(url);

      const response = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "text/html", "User-Agent": "Chatify link preview" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) return null;
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) return null;

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_BYTES) return null;

      const html = (await response.text()).slice(0, MAX_BYTES);

      const title = metaContent(html, "og:title") || decode(html.match(/<title[^>]*>([^<]*)</i)?.[1] ?? "");
      const description = metaContent(html, "og:description") || metaContent(html, "description");
      const image = metaContent(html, "og:image");
      const siteName = metaContent(html, "og:site_name");

      if (!title && !description && !image) return null;

      return { url: url.toString(), title, description, image, siteName };
    }

    return null;
  } catch {
    // A URL that will not unfurl is not an error worth surfacing — the message
    // already sent, and the preview is decoration.
    return null;
  }
};
