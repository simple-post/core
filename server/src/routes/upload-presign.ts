import { randomUUID } from "node:crypto";

import { getPresignedUploadUrl, generateFileKey } from "@simple-post/sdk";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@simple-post/sdk/media-types";
import { Router } from "express";
import { z } from "zod";

import { BadRequestError, handleApiError } from "../utils/errors.js";

import type { Request, Response } from "express";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const requestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
});

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const input = requestSchema.parse(req.body);
    const contentType = normalizeContentType(input.contentType, input.filename);
    if (!contentType || !ALLOWED_MEDIA_TYPES.has(contentType)) {
      throw new BadRequestError(`Unsupported media type: ${input.contentType}`);
    }

    const key = generateFileKey("server", input.filename);
    const expiresIn = 15 * 60;
    const { uploadUrl, publicUrl } = await getPresignedUploadUrl(key, contentType, expiresIn, {
      contentLength: input.size,
    });

    res.json({
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expiresIn,
      key,
      media: {
        id: randomUUID(),
        url: publicUrl,
        type: contentType.startsWith("video/") ? "video" : "image",
        filename: input.filename,
        size: input.size,
      },
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
