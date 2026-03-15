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

export function normalizeContentType(contentType: string, filename: string): string | undefined {
  if (contentType === "image/jpg") {
    return "image/jpeg";
  }

  if (contentType) {
    return contentType;
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_TYPE[ext];
}
