import { Router } from "express";
import multer from "multer";

import { storeUpload } from "../services/uploads.js";
import { BadRequestError, handleApiError } from "../utils/errors.js";
import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "../utils/media-types.js";

import type { Request, Response } from "express";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const router = Router();

router.post("/", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      throw new BadRequestError("No file provided");
    }

    const resolvedType = normalizeContentType(file.mimetype, file.originalname);
    if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
      throw new BadRequestError(`Invalid file type: ${file.mimetype || "(unknown)"}`);
    }

    const stored = await storeUpload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: resolvedType,
      size: file.size,
    });

    res.status(201).json(stored);
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
