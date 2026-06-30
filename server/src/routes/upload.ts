import fs from "node:fs/promises";

import { ALLOWED_MEDIA_TYPES, normalizeContentType } from "@simple-post/sdk/media-types";
import { Router } from "express";
import multer from "multer";

import { storeUpload } from "../services/uploads.js";
import { BadRequestError, handleApiError } from "../utils/errors.js";
import { ensureUploadTmpDir } from "../utils/files.js";

import type { Request, Response } from "express";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

// Stream uploads to disk: buffering up to 500 MB per request in memory
// (memoryStorage) lets a handful of concurrent video uploads OOM the process.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureUploadTmpDir()
        .then((dir) => callback(null, dir))
        .catch((error: Error) => callback(error, ""));
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const router = Router();

router.post("/", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  try {
    if (!file) {
      throw new BadRequestError("No file provided");
    }

    const resolvedType = normalizeContentType(file.mimetype, file.originalname);
    if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
      throw new BadRequestError(`Invalid file type: ${file.mimetype || "(unknown)"}`);
    }

    const stored = await storeUpload({
      tempPath: file.path,
      originalName: file.originalname,
      mimeType: resolvedType,
      size: file.size,
    });

    res.status(201).json(stored);
  } catch (error) {
    if (file?.path) {
      await fs.unlink(file.path).catch(() => {});
    }
    handleApiError(error, res);
  }
});

export default router;
