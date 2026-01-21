import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireAuth } from "@/lib/middleware/auth";
import { getPresignedUploadUrl, generateFileKey } from "@/lib/r2";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

const presignRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  isThumbnail: z.boolean().optional(),
});

// POST /api/upload/presign - Get a presigned URL for direct upload to R2
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const userId = session.user.id;

    const body = await req.json();
    const validated = presignRequestSchema.parse(body);

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

    if (!allowedTypes.includes(validated.contentType)) {
      throw new BadRequestError(`Invalid content type: ${validated.contentType}`);
    }

    // Generate a unique key for the file
    const filename = validated.isThumbnail ? `thumb_${validated.filename}` : validated.filename;
    const key = generateFileKey(userId, filename);

    // Get presigned URL (valid for 1 hour)
    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(key, validated.contentType, 3600);

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
