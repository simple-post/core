import { type NextRequest, NextResponse } from "next/server";

import { getPresignedUploadUrl, generateFileKey } from "@simple-post/sdk";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@simple-post/sdk/media-types";
import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

const presignRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024),
  isThumbnail: z.boolean().optional(),
});

// POST /api/v1/upload/presign - Get a presigned URL for direct upload to R2
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

    if (!ALLOWED_MEDIA_TYPES.has(resolvedContentType)) {
      throw new BadRequestError(`Invalid content type: ${resolvedContentType}`);
    }

    // Generate a unique key for the file
    const filename = validated.isThumbnail ? `thumb_${validated.filename}` : validated.filename;
    const key = generateFileKey(userId, filename);

    // Get presigned URL (valid for 1 hour)
    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(key, resolvedContentType, 3600, {
      contentLength: validated.size,
    });

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
