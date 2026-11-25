import { computeEngagements, getAccountAnalytics, getPostAnalytics } from "@simple-post/sdk";
import { Router } from "express";

import { getAccountById, getAccounts } from "../config/accounts.js";
import { AnalyticsPostsRequestSchema } from "../openapi/schemas.js";
import { buildPostOptions } from "../services/credentials.js";
import { BadRequestError, handleApiError, ValidationError } from "../utils/errors.js";

import type { ConfiguredAccount } from "../config/accounts.js";
import type { Request, Response } from "express";

const router = Router();

/** Reads analytics for posts published through configured accounts (stateless; nothing is cached). */
router.post("/posts", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = AnalyticsPostsRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const byAccount = new Map<string, { account: ConfiguredAccount; targets: typeof parsed.data.targets }>();
    for (const target of parsed.data.targets) {
      const account = getAccountById(target.accountId);
      if (!account) throw new BadRequestError(`Account not found: ${target.accountId}`);
      const group = byAccount.get(account.id) ?? { account, targets: [] };
      group.targets.push(target);
      byAccount.set(account.id, group);
    }

    const results = [];
    for (const { account, targets } of byAccount.values()) {
      const response = await getPostAnalytics({
        platform: account.platform,
        targets: targets.map(({ postId, uri, mediaType }) => ({ postId, uri, mediaType })),
        options: buildPostOptions(account),
      });
      for (const result of response.results)
        results.push({ accountId: account.id, ...result, engagements: computeEngagements(result.metrics) ?? null });
    }
    res.status(200).json({ results });
  } catch (error) {
    handleApiError(error, res);
  }
});

/** Follower counts and other account-level analytics for configured accounts. */
router.get("/accounts", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.query.accountId as string | string[] | undefined;
    const values = Array.isArray(raw) ? raw : [raw ?? ""];
    const requested = values.flatMap((value) => value.split(",")).filter(Boolean);
    const accounts = requested.length > 0 ? requested.map((id) => getAccountById(id)) : getAccounts();
    if (accounts.some((account) => !account)) throw new BadRequestError("One or more accounts were not found");

    const results = [];
    for (const account of accounts as ConfiguredAccount[]) {
      const { refreshedCredentials: _refreshed, ...result } = await getAccountAnalytics({
        platform: account.platform,
        options: buildPostOptions(account),
      });
      results.push({ accountId: account.id, ...result });
    }
    res.status(200).json({ accounts: results });
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
