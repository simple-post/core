import { fitRemoteImagesForAccounts, type ImageFit, type ThreadSegment, type ValidationIssue } from "@simple-post/sdk";
import { hydrateRemoteMediaSizesForAccounts } from "@simple-post/sdk";

import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { requireImageFitting } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata } from "@/lib/security/connected-account-secrets";
import { queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { validateAccountReadiness } from "@/lib/validation/account-readiness";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";

function addMediaInspectionFailures(
  validation: ValidationResultByPlatform,
  failures: ValidationIssue[],
): ValidationResultByPlatform {
  for (const failure of failures) {
    const result = validation.results.find((candidate) => candidate.accountId === failure.meta?.accountId);
    if (result) {
      if (failure.severity === "warning") result.warnings.push(failure);
      else {
        result.errors.push(failure);
        result.isValid = false;
      }
    }
    if (failure.severity === "warning") validation.summary.warnings.push(failure);
    else validation.summary.errors.push(failure);
  }

  validation.summary.isValid = validation.summary.errors.length === 0;
  return validation;
}

export async function validatePostForAccounts(params: {
  imageFit?: ImageFit;
  userId: string;
  message: string;
  media: MediaFile[];
  accountIds: string[];
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
}): Promise<ValidationResultByPlatform> {
  if (params.imageFit) await requireImageFitting(params.userId);
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
      tokenMetadata: { previewOnly: isPreviewOnlyTokenMetadata(tokenMetadata) },
      previewOnly: isPreviewOnlyTokenMetadata(tokenMetadata),
    };
  });

  if (params.imageFit) {
    if (resolvedAccounts.length !== new Set(params.accountIds).size)
      throw new Error("One or more accounts were not found");
    await fitRemoteImagesForAccounts(params, resolvedAccounts, params.imageFit, params.userId, async (url) => {
      await prisma.$transaction((tx) => queueStorageDeletion(tx, params.userId, url));
    });
  }

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
    mediaFormatHints: false,
    message: params.message,
    media: params.media,
    accounts: resolvedAccounts,
    accountOptions: params.accountOptions,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
  });

  addMediaInspectionFailures(validation, inspectionFailures);
  await validateAccountReadiness(validation, params);
  return validation;
}
