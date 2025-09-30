import { post, PostSchema, type Post, type PostResult, type Platform } from "@simple-post/sdk";
import { Router, type Request, type Response } from "express";
import multer from "multer";

import { createTempDir, saveTempFiles, cleanupTempDir, transformMediaPaths, type TempFile } from "../utils/files.js";

const router = Router();

// Configure multer for file uploads (in-memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 100MB limit per file
    files: 20, // Maximum 20 files
  },
});

router.post("/", upload.array("files"), async (req: Request, res: Response): Promise<void> => {
  let tempDir: string | null = null;
  let tempFiles: TempFile[] = [];

  try {
    // Parse JSON body
    let postData: Post;
    try {
      postData = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
    } catch (error) {
      res.status(400).json({
        error: "Invalid JSON",
        message: "Request body must be valid JSON",
        details: error instanceof Error ? error.message : "Unknown JSON parsing error",
      });
      return;
    }

    // Validate the post data using SDK schema
    const validationResult = PostSchema.safeParse(postData);
    if (!validationResult.success) {
      res.status(400).json({
        error: "Validation failed",
        message: "Request body does not match expected schema",
        details: validationResult.error.issues,
      });
      return;
    }

    const validatedPost = validationResult.data;

    // Handle file uploads if present
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      tempDir = await createTempDir();
      tempFiles = await saveTempFiles(req.files, tempDir);

      // Transform media paths in the post content
      if (validatedPost.content.media) {
        validatedPost.content.media = transformMediaPaths(validatedPost.content.media, tempFiles);
      }
    }

    // Call the SDK post function
    const results: Map<Platform, PostResult> = await post(validatedPost);

    // Convert Map to object for JSON response
    const resultsObject: Record<string, PostResult> = {};
    for (const [platform, result] of results.entries()) {
      resultsObject[platform] = result;
    }

    res.json({
      success: true,
      results: resultsObject,
    });
  } catch (error) {
    console.error("Error in /post endpoint:", error);

    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
      details: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    // Clean up temporary files
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
});

export default router;
