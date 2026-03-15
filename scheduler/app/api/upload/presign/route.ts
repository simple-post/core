import { type NextRequest, NextResponse } from "next/server";

import { getPresignedUploadUrl, generateFileKey } from "@simple-post/sdk";
import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

const presignRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  isThumbnail: z.boolean().optional(),
});

const EXTENSION_TO_TYPE: Record<string, string> = {
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

const normalizeContentType = (contentType: string, filename: string): string | undefined => {
  if (contentType === "image/jpg") {
    return "image/jpeg";
  }

  if (contentType) {
    return contentType;
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_TYPE[ext];
};

// POST /api/upload/presign - Get a presigned URL for direct upload to R2
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const userId = session.user.id;

    const body = await req.json();
    const validated = presignRequestSchema.parse(body);

    const resolvedContentType = normalizeContentType(validated.contentType, validated.filename);

    if (!resolvedContentType) {
      throw new BadRequestError("Invalid content type");
    }

    // Validate content type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ];

    if (!allowedTypes.includes(resolvedContentType)) {
      throw new BadRequestError(`Invalid content type: ${resolvedContentType}`);
    }

    // Generate a unique key for the file
    const filename = validated.isThumbnail ? `thumb_${validated.filename}` : validated.filename;
    const key = generateFileKey(userId, filename);

    // Get presigned URL (valid for 1 hour)
    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(key, resolvedContentType, 3600);

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
