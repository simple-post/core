/**
 * Media content types accepted across SimplePost upload surfaces (HTTP
 * server, scheduler, MCP). The set is intentionally limited to formats the
 * supported platforms actually publish — accepting e.g. AVI uploads only
 * defers the failure to publish time. Browser-safe: no Node imports.
 */

export const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const EXTENSION_TO_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Normalizes a reported content type (stripping parameters, lowercasing,
 * mapping the common image/jpg misnomer), falling back to the filename
 * extension when no content type was reported.
 */
export function normalizeContentType(contentType: string, filename: string): string | undefined {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();

  if (normalized === "image/jpg") {
    return "image/jpeg";
  }

  if (normalized) {
    return normalized;
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_TYPE[ext];
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCodePoint(...bytes.subarray(start, end));
}

/**
 * Checks the identifying bytes at the start of a supported media file. This
 * intentionally performs format identification, not full media decoding.
 */
export function mediaHeaderMatchesContentType(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71 &&
      bytes[4] === 13 &&
      bytes[5] === 10 &&
      bytes[6] === 26 &&
      bytes[7] === 10
    );
  }
  if (contentType === "image/gif") {
    const signature = ascii(bytes, 0, 6);
    return bytes.length >= 6 && (signature === "GIF87a" || signature === "GIF89a");
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  }
  if (contentType === "video/mp4" || contentType === "video/quicktime") {
    return bytes.length >= 8 && ascii(bytes, 4, 8) === "ftyp";
  }
  if (contentType === "video/webm") {
    return bytes.length >= 4 && bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163;
  }
  return false;
}
