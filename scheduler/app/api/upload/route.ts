import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { uploadToR2, generateFileKey } from "@/lib/r2";
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

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestError(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      throw new BadRequestError(`Invalid file type: ${file.type}`);
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate a unique key for the file
    const key = generateFileKey(userId, file.name);

    // Upload to R2
    const url = await uploadToR2(buffer, key, file.type);

    return NextResponse.json({
      url,
      key,
      filename: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Configure Next.js to handle large file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};
