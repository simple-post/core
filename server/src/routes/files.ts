import { Router, type Request, type Response, type Express } from "express";
import multer from "multer";

import { deleteStoredFile, ensureStorageDir, getStoredFileInfo, sanitizeFilename } from "../utils/files.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureStorageDir()
        .then((storageDir) => cb(null, storageDir))
        .catch((error) => cb(error as Error, ""));
    },
    filename: (_req, file, cb) => {
      const safeName = sanitizeFilename(file.originalname);
      if (!safeName) {
        cb(new Error("Invalid filename"), "");
        return;
      }
      cb(null, safeName);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit per file
    files: 20,
  },
});

const uploadHandler = upload.fields([
  { name: "files", maxCount: 20 },
  { name: "file", maxCount: 1 },
]);

router.post("/", (req: Request, res: Response): void => {
  uploadHandler(req, res, (error) => {
    if (error) {
      res.status(400).json({
        error: "Upload failed",
        message: error.message,
      });
      return;
    }

    const uploadedFiles = collectUploadedFiles(req.files);
    if (uploadedFiles.length === 0) {
      res.status(400).json({
        error: "No files uploaded",
        message: "Provide at least one file using 'file' or 'files' fields",
      });
      return;
    }

    res.status(201).json({
      success: true,
      files: uploadedFiles.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
      })),
    });
  });
});

router.get("/:filename/download", async (req: Request, res: Response): Promise<void> => {
  const safeName = sanitizeFilename(req.params.filename);
  if (!safeName) {
    res.status(400).json({
      error: "Invalid filename",
      message: "Filename must not include path separators",
    });
    return;
  }

  try {
    const info = await getStoredFileInfo(safeName);
    if (!info) {
      res.status(404).json({
        error: "File not found",
        message: `File '${safeName}' does not exist`,
      });
      return;
    }

    res.download(info.path, safeName);
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
});

router.get("/:filename", async (req: Request, res: Response): Promise<void> => {
  const safeName = sanitizeFilename(req.params.filename);
  if (!safeName) {
    res.status(400).json({
      error: "Invalid filename",
      message: "Filename must not include path separators",
    });
    return;
  }

  try {
    const info = await getStoredFileInfo(safeName);
    if (!info) {
      res.status(404).json({
        error: "File not found",
        message: `File '${safeName}' does not exist`,
        exists: false,
      });
      return;
    }

    res.json({
      exists: true,
      file: {
        filename: info.filename,
        size: info.size,
        lastModified: info.lastModified,
      },
      downloadUrl: `/files/${encodeURIComponent(info.filename)}/download`,
    });
  } catch (error) {
    console.error("Error checking file status:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
});

router.delete("/:filename", async (req: Request, res: Response): Promise<void> => {
  const safeName = sanitizeFilename(req.params.filename);
  if (!safeName) {
    res.status(400).json({
      error: "Invalid filename",
      message: "Filename must not include path separators",
    });
    return;
  }

  try {
    const deleted = await deleteStoredFile(safeName);
    if (!deleted) {
      res.status(404).json({
        error: "File not found",
        message: `File '${safeName}' does not exist`,
      });
      return;
    }

    res.json({
      success: true,
      message: `File '${safeName}' deleted`,
    });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
});

function collectUploadedFiles(files: Request["files"]): Express.Multer.File[] {
  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files;
  }

  const fileGroups = Object.values(files) as Express.Multer.File[][];
  return fileGroups.flat();
}

export default router;
