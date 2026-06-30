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
