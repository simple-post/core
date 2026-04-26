import { uploadFromBuffer, generateFileKey } from "@simple-post/sdk";
import { z } from "zod";

import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@/lib/utils/media-types";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

export const uploadMediaSchema = z.object({
  filename: z
    .string()
    .min(1)
    .describe("Original filename including extension, e.g. 'photo.jpg' or 'clip.mp4'."),
  mimeType: z
    .string()
    .min(1)
    .describe(
      "MIME type of the file. Supported: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/quicktime, video/webm.",
    ),
  data: z.string().min(1).describe("Base64-encoded file contents (no data URL prefix)."),
});

export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;

export async function uploadMedia(userId: string, input: UploadMediaInput) {
  const resolvedType = normalizeContentType(input.mimeType, input.filename);
  if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
    throw new Error(
      `Unsupported media type: ${input.mimeType}. Allowed: ${[...ALLOWED_MEDIA_TYPES].join(", ")}`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.data, "base64");
  } catch {
    throw new Error("Invalid base64 data");
  }

  if (buffer.length === 0) {
    throw new Error("File is empty or base64 data is invalid");
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const key = generateFileKey(userId, input.filename);
  const url = await uploadFromBuffer(buffer, key, resolvedType);

  return {
    type: resolvedType.startsWith("video/") ? ("video" as const) : ("image" as const),
    url,
    filename: input.filename,
    size: buffer.length,
    mimeType: resolvedType,
  };
}
