import { isRepostCapablePlatform } from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import type { AccountRepostTarget } from "@/lib/posting";
import type { AccountPublishResult, AccountResultsMap } from "@/types";

export interface RepostTargetAccount {
  id: string;
  platform: string;
}

export interface RepostTargetSource {
  accountResults: unknown;
  accounts: RepostTargetAccount[];
}

/**
 * Turns a single account's publish result into a repost target, or null if the
 * account can't be reposted (failed publish, missing post id, non-capable
 * platform, or — for Bluesky — a missing uri/cid). This is the single source of
 * truth for repost eligibility; both target construction and the
 * "does this post have any repost targets?" check go through it.
 */
export function buildRepostTargetFromResult(
  accountId: string,
  platform: string,
  result: AccountPublishResult | undefined,
): AccountRepostTarget | null {
  const mapped = mapPlatformName(platform);
  if (!result?.success || !result.postId || !isRepostCapablePlatform(mapped)) {
    return null;
  }

  if (mapped === "bluesky") {
    const platformData = result.platformData as { uri?: string; cid?: string } | undefined;
    if (!platformData?.uri || !platformData.cid) {
      return null;
    }
    return {
      accountId,
      postId: result.postId,
      postUrl: result.postUrl,
      uri: platformData.uri,
      cid: platformData.cid,
    };
  }

  return {
    accountId,
    postId: result.postId,
    postUrl: result.postUrl,
  };
}

export function buildRepostTargets(source: RepostTargetSource): AccountRepostTarget[] {
  const accountResults = (source.accountResults as AccountResultsMap | null) ?? {};

  return source.accounts.flatMap((account) => {
    const target = buildRepostTargetFromResult(account.id, account.platform, accountResults[account.id]);
    return target ? [target] : [];
  });
}
