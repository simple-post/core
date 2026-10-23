import crypto from "node:crypto";
import { ConfigurationError } from "@pipedream/platform";
import constants from "./constants.mjs";

/**
 * Parses a JSON prop value. Object props arrive already deserialized; string
 * props are parsed so users can paste or map JSON from earlier steps.
 * @param {string|object|undefined} value - The raw prop value
 * @param {string} label - The prop label, used in error messages
 * @returns {object|array|undefined} The parsed value
 */
function parseJson(value, label) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new ConfigurationError(`**${label}** must be valid JSON.`);
  }
}

/**
 * Combines **Media URLs** and **Media (JSON)** into the `media` request field.
 * **Media (JSON)** accepts one media object (the `media` output of **Upload
 * Media**) or an array of them.
 * @param {string[]} urls - Public image or video URLs
 * @param {string|object|undefined} json - The **Media (JSON)** prop value
 * @returns {object[]|undefined} Media objects, or undefined when there are none
 */
function buildMedia(urls, json) {
  const parsed = parseJson(json, "Media (JSON)");
  const media = [
    ...mediaFromUrls(urls),
    ...(parsed === undefined
      ? []
      : [].concat(parsed)),
  ];
  return media.length
    ? media
    : undefined;
}

/**
 * Converts any parseable date-time to the UTC ISO 8601 form the Scheduler API
 * requires (it rejects offsets and zone-less values).
 * @param {string} value - A date-time string, e.g. `2030-01-01T14:00:00+02:00`
 * @returns {string} The UTC timestamp, e.g. `2030-01-01T12:00:00.000Z`
 */
function toUtcIsoString(value) {
  const parsed = new Date(value ?? "");
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new ConfigurationError("**Scheduled For** must be a valid ISO 8601 date and time, e.g. `2030-01-01T09:00:00Z`.");
  }
  return parsed.toISOString();
}

function extensionOf(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new ConfigurationError(`\`${url}\` is not a valid media URL.`);
  }
  const filename = decodeURIComponent(pathname.split("/").filter(Boolean)
    .pop() ?? "media");
  const extension = filename.includes(".")
    ? filename.split(".").pop()
      .toLowerCase()
    : "";
  return {
    filename,
    extension,
  };
}

/**
 * Builds Scheduler media objects from public URLs. The Scheduler imports each
 * URL into SimplePost storage when the post is saved.
 * @param {string[]} urls - Public image or video URLs
 * @returns {object[]} Media objects for the `media` request field
 */
function mediaFromUrls(urls = []) {
  return urls.filter(Boolean).map((url, index) => {
    const {
      filename, extension,
    } = extensionOf(url);
    const contentType = constants.EXTENSION_TO_CONTENT_TYPE[extension];
    if (!contentType) {
      throw new ConfigurationError(`Cannot tell whether \`${url}\` is an image or a video. Use a URL ending in .jpg, .jpeg, .png, .gif, .webp, .mp4, .m4v, .mov, or .webm, upload the file with **Upload Media**, or describe it in **Media (JSON)**.`);
    }
    return {
      id: `media-${index + 1}`,
      url,
      type: contentType.startsWith("video/")
        ? "video"
        : "image",
      contentType,
      filename,
      size: 0,
    };
  });
}

/**
 * Verifies an `X-SimplePost-Signature` header: HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the endpoint secret, hex encoded.
 * @param {object} args
 * @param {string} args.secret - The webhook signing secret
 * @param {string} args.timestamp - The `X-SimplePost-Timestamp` header (ms)
 * @param {string} args.signature - The `X-SimplePost-Signature` header
 * @param {string} args.rawBody - The unparsed request body
 * @param {number} [args.now] - Current time in ms, for tests
 * @returns {boolean} Whether the signature is valid and fresh
 */
function isValidSignature({
  secret, timestamp, signature, rawBody, now = Date.now(),
}) {
  if (!secret || !timestamp || !signature || typeof rawBody !== "string") {
    return false;
  }
  if (Math.abs(now - Number(timestamp)) > constants.SIGNATURE_TOLERANCE_MS) {
    return false;
  }
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Formats a connected account for option labels and summaries.
 * @param {object} account - An account from `GET /api/v1/accounts`
 * @returns {string} e.g. `Jane Doe (@jane, bluesky)`
 */
function accountLabel(account) {
  const name = account.displayName || account.username || account.id;
  const handle = account.username && account.username !== name
    ? `@${account.username}, `
    : "";
  const reconnect = account.credentialStatus?.state === "reauth_required"
    ? " - reconnect required"
    : "";
  return `${name} (${handle}${account.platform})${reconnect}`;
}

export default {
  parseJson,
  toUtcIsoString,
  mediaFromUrls,
  buildMedia,
  isValidSignature,
  accountLabel,
};
