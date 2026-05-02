import { Router } from "express";

import { getStoredFileInfo, sanitizeFilename } from "../utils/files.js";

import type { Request, Response } from "express";

const router = Router();

router.get("/:filename", async (req: Request, res: Response): Promise<void> => {
  const safeName = sanitizeFilename(req.params.filename);
  if (!safeName) {
    res.status(400).json({ error: "Invalid filename", code: "BAD_REQUEST" });
    return;
  }

  try {
    const info = await getStoredFileInfo(safeName);
    if (!info) {
      res.status(404).json({ error: "File not found", code: "NOT_FOUND" });
      return;
    }
    res.sendFile(info.path);
  } catch (error) {
    console.error("Error serving media:", error);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;
