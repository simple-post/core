import { Router } from "express";

import { getAccountsByIds } from "../config/accounts.js";
import { RepostRequestSchema } from "../openapi/schemas.js";
import { getPostingSummary, repostToAccounts } from "../services/posting.js";
import { BadRequestError, handleApiError, sanitizeForJson, ValidationError } from "../utils/errors.js";

import type { Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = RepostRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(parseResult.error.issues);
    }
    const validated = parseResult.data;

    const accounts = getAccountsByIds(validated.accountIds ?? Object.keys(validated.accountTargets ?? {}));
    const accountIds = validated.accountIds ?? accounts.map((account) => account.id);
    if (accounts.length !== accountIds.length) {
      throw new BadRequestError("One or more accounts were not found");
    }

    const results = await repostToAccounts(
      accountIds,
      validated.target,
      validated.accountTargets,
      validated.accountOptions
    );
    const summary = getPostingSummary(results);

    const sanitizedResults = results.map((r) => ({
      accountId: r.accountId,
      platform: r.platform,
      success: r.success,
      error: r.error,
      message: r.message,
      postId: r.postId,
      postUrl: r.postUrl,
      details: r.details ? (sanitizeForJson(r.details) as Record<string, unknown>) : undefined,
    }));

    res.status(200).json({ repostingResults: sanitizedResults, summary });
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
