import { post, PostSchema, type Post, type PostResult, type Platform } from "@simple-post/sdk";
import { Router, type Request, type Response } from "express";

import { resolveStoredMediaPaths } from "../utils/files.js";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    // Parse JSON body
    let postData: Post;
    try {
      const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      let normalizedBody = rawBody;

      if (rawBody && typeof rawBody === "object" && "data" in rawBody) {
        const dataField = (rawBody as { data?: unknown }).data;
        if (typeof dataField === "string") {
          normalizedBody = JSON.parse(dataField);
        } else if (dataField) {
          normalizedBody = dataField;
        }
      }

      postData = normalizedBody as Post;
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

    if (validatedPost.content.media) {
      const resolved = await resolveStoredMediaPaths(validatedPost.content.media);
      if (resolved.invalid.length > 0) {
        res.status(400).json({
          error: "Invalid file reference",
          message: "File references must be plain filenames without path separators",
          details: resolved.invalid,
        });
        return;
      }

      if (resolved.missing.length > 0) {
        res.status(404).json({
          error: "File not found",
          message: "One or more referenced files are missing from storage",
          details: resolved.missing,
        });
        return;
      }

      if (resolved.resolved) {
        validatedPost.content.media = resolved.resolved;
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
  }
});

export default router;
