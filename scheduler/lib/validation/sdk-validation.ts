import { hydrateRemoteMediaSizesForAccounts } from "@simple-post/sdk";

import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata } from "@/lib/security/connected-account-secrets";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";
import type { ThreadSegment, ValidationIssue } from "@simple-post/sdk";

function addMediaInspectionFailures(
  validation: ValidationResultByPlatform,
  failures: ValidationIssue[],
): ValidationResultByPlatform {
  for (const failure of failures) {
    const result = validation.results.find((candidate) => candidate.accountId === failure.meta?.accountId);
    if (result) {
      result.errors.push(failure);
      result.isValid = false;
    }
    validation.summary.errors.push(failure);
  }

  validation.summary.isValid = validation.summary.errors.length === 0;
  return validation;
}

export async function validatePostForAccounts(params: {
  userId: string;
  message: string;
  media: MediaFile[];
  accountIds: string[];
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
}): Promise<ValidationResultByPlatform> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      userId: params.userId,
      id: { in: params.accountIds },
    },
  });

  const resolvedAccounts: ConnectedAccount[] = accounts.map((account) => {
    const tokenMetadata = decryptTokenMetadata(account.tokenMetadata);

    return {
      ...account,
      accessToken: "",
      refreshToken: null,
      tokenMetadata,
      previewOnly: isPreviewOnlyTokenMetadata(tokenMetadata),
    };
  });

  // Never trust caller-provided byte counts for URL-backed media. This shared
  // boundary is used by the HTTP API, MCP tools, and scheduled posts. Updating
  // the objects in place also ensures create/update callers persist the
  // measured value instead of 0 or stale metadata.
  const inspectionFailures = await hydrateRemoteMediaSizesForAccounts({
    media: params.media,
    accounts: resolvedAccounts,
    accountOptions: params.accountOptions,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
  });

  const validation = validatePostForResolvedAccounts({
    message: params.message,
    media: params.media,
    accounts: resolvedAccounts,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
  });

  return addMediaInspectionFailures(validation, inspectionFailures);
}
