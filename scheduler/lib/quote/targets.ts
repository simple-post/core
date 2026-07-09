import { isQuoteCapablePlatform } from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import type { AccountQuoteTarget } from "@/lib/posting";
import type { AccountPublishResult, AccountResultsMap } from "@/types";

export interface QuoteTargetAccount {
  id: string;
  platform: string;
}

export interface QuoteTargetSource {
  accountResults: unknown;
  accounts: QuoteTargetAccount[];
}

function targetFromResult(
  accountId: string,
  platform: string,
  result: AccountPublishResult | undefined,
): AccountQuoteTarget | null {
  const mapped = mapPlatformName(platform);
  if (!result?.success || !result.postId || !isQuoteCapablePlatform(mapped)) {
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

/**
 * Resolves one native quote target per destination account. An exact account
 * match wins; otherwise the first successful source post on the same platform
 * is used. Unsupported platforms and missing platform results are omitted so
 * the posting layer can intentionally publish ordinary content there.
 */
export function buildQuoteTargets(
  source: QuoteTargetSource,
  destinationAccounts: QuoteTargetAccount[],
): AccountQuoteTarget[] {
  const accountResults = (source.accountResults as AccountResultsMap | null) ?? {};

  return destinationAccounts.flatMap((destination) => {
    const destinationPlatform = mapPlatformName(destination.platform);
    if (!isQuoteCapablePlatform(destinationPlatform)) {
      return [];
    }

    const exactSource = source.accounts.find(
      (account) => account.id === destination.id && mapPlatformName(account.platform) === destinationPlatform,
    );
    if (exactSource) {
      const exactTarget = targetFromResult(destination.id, exactSource.platform, accountResults[exactSource.id]);
      if (exactTarget) return [exactTarget];
    }

    for (const sourceAccount of source.accounts) {
      if (mapPlatformName(sourceAccount.platform) !== destinationPlatform) continue;
      const target = targetFromResult(destination.id, sourceAccount.platform, accountResults[sourceAccount.id]);
      if (target) return [target];
    }

    return [];
  });
}

export function hasSuccessfulQuoteSourceResult(source: QuoteTargetSource): boolean {
  return Object.values((source.accountResults as AccountResultsMap | null) ?? {}).some((result) => result.success);
}
