import { supportsPostAnalytics, type AnalyticsTarget } from "@simple-post/sdk/analytics";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import type { AccountPublishResult, AccountResultsMap } from "@/types";

export interface AnalyticsSourcePost {
  id: string;
  userId: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
  accountResults: unknown;
  media?: Array<{ type: string }>;
  accounts: Array<{ id: string; platform: string }>;
}

export interface PostAnalyticsSeed {
  postId: string;
  userId: string;
  accountId: string;
  platform: string;
  platformPostId: string;
  publishedAt: Date;
}

/**
 * Every account of a post that published successfully gets one analytics row.
 * Partially failed posts still count: their successful accounts are live.
 */
export function analyticsSeedsForPost(post: AnalyticsSourcePost): PostAnalyticsSeed[] {
  const results = (post.accountResults as AccountResultsMap | null) ?? {};
  const accountIds = new Set(post.accounts.map((account) => account.id));
  const seeds: PostAnalyticsSeed[] = [];

  for (const [accountId, result] of Object.entries(results)) {
    if (!accountIds.has(accountId) || !isAnalyzableResult(result)) continue;
    const platform = mapPlatformName(result.platform);
    const completedAt = result.completedAt ? new Date(result.completedAt) : null;
    seeds.push({
      postId: post.id,
      userId: post.userId,
      accountId,
      platform,
      platformPostId: result.postId!,
      publishedAt:
        completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : (post.publishedAt ?? post.updatedAt),
    });
  }

  return seeds;
}

function isAnalyzableResult(result: AccountPublishResult | undefined): boolean {
  return Boolean(result?.success && result.postId && result.platform);
}

/** Whether SimplePost can read analytics for at least one account of this post. */
export function hasAnalyzableAccounts(post: AnalyticsSourcePost): boolean {
  return analyticsSeedsForPost(post).some((seed) => supportsPostAnalytics(seed.platform));
}

/** Builds the SDK target for a stored row, adding publish-time hints from accountResults. */
export function analyticsTargetFor(
  row: { platformPostId: string; accountId: string; publishedAt?: Date },
  post: { accountResults: unknown; media?: Array<{ type: string }> } | null | undefined,
): AnalyticsTarget {
  const result = ((post?.accountResults as AccountResultsMap | null) ?? {})[row.accountId];
  const platformData = result?.platformData;
  const media = post?.media ?? [];
  const mediaType: AnalyticsTarget["mediaType"] =
    media.length === 0 ? "text" : media.length > 1 ? "carousel" : media[0].type === "video" ? "video" : "image";

  return {
    postId: row.platformPostId,
    ...(platformData ? { platformData } : {}),
    ...(typeof platformData?.uri === "string" ? { uri: platformData.uri } : {}),
    mediaType,
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
  };
}
