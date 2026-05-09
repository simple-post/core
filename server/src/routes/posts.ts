import { randomUUID } from "node:crypto";

import { Router } from "express";

import { getAccountsByIds } from "../config/accounts.js";
import { CreatePostRequestSchema } from "../openapi/schemas.js";
import { getPostingSummary, postToAccounts } from "../services/posting.js";
import { validatePostForAccounts } from "../services/validation.js";
import { BadRequestError, handleApiError, sanitizeForJson, ValidationError } from "../utils/errors.js";

import type { MediaFile } from "@simple-post/sdk";
import type { Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = CreatePostRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(parseResult.error.issues);
    }
    const validated = parseResult.data;

    if (validated.postingMode !== "now") {
      throw new BadRequestError(
        'Scheduling is not supported by the self-hosted server. Use postingMode: "now" or run the scheduler app.'
      );
    }

    const accounts = getAccountsByIds(validated.accountIds);
    if (accounts.length !== validated.accountIds.length) {
      throw new BadRequestError("One or more accounts were not found");
    }

    const mediaFiles: MediaFile[] = validated.media || [];

    const validation = validatePostForAccounts({
      message: validated.message,
      media: mediaFiles,
      accountIds: validated.accountIds,
      accountOverrides: validated.accountOverrides,
      thread: validated.thread,
    });

    if (!validation.summary.isValid) {
      throw new ValidationError(validation);
    }

    const results = await postToAccounts(
      validated.message,
      mediaFiles,
      validated.accountIds,
      validated.accountOptions,
      validated.accountOverrides,
      validated.thread
    );
    const summary = getPostingSummary(results);

    const post = {
      id: randomUUID(),
      message: validated.message,
      accountIds: validated.accountIds,
      media: mediaFiles,
      thread: validated.thread,
      scheduledFor: new Date().toISOString(),
      status: summary.overallSuccess ? "published" : "failed",
      createdAt: new Date().toISOString(),
      publishedAt: summary.overallSuccess ? new Date().toISOString() : undefined,
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides,
    };

    const sanitizedResults = results.map((r) => ({
      accountId: r.accountId,
      platform: r.platform,
      success: r.success,
      error: r.error,
      message: r.message,
      postId: r.postId,
      postUrl: r.postUrl,
      details: r.details ? (sanitizeForJson(r.details) as Record<string, unknown>) : undefined,
      threadResults: r.threadResults?.map((s) => ({
        index: s.index,
        success: s.success,
        postId: s.postId,
        postUrl: s.postUrl,
        error: s.error,
        message: s.message,
        details: s.details ? (sanitizeForJson(s.details) as Record<string, unknown>) : undefined,
      })),
    }));

    res.status(201).json({ post, postingResults: sanitizedResults, summary });
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
