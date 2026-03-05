import { type NextRequest, NextResponse } from "next/server";

import {
  uploadFromBuffer,
  generateFileKey,
} from "@simple-post/sdk";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

// Maximum file size: 500MB
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

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

// POST /api/upload - Upload a file directly through the server (fallback for CORS issues)
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const userId = session.user.id;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      throw new BadRequestError("No file provided");
    }

    const resolvedType = normalizeContentType(file.type, file.name);

    if (!resolvedType) {
      throw new BadRequestError("Invalid file type");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestError(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    if (!ALLOWED_TYPES.has(resolvedType)) {
      throw new BadRequestError(`Invalid file type: ${resolvedType}`);
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate a unique key for the file
    const key = generateFileKey(userId, file.name);

    // Upload to S3-compatible storage
    const url = await uploadFromBuffer(buffer, key, resolvedType);

    return NextResponse.json({
      url,
      key,
      filename: file.name,
      size: file.size,
      type: resolvedType,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
