import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata } from "@/lib/security/connected-account-secrets";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";
import type { ThreadSegment } from "@simple-post/sdk";

export async function validatePostForAccounts(params: {
  userId: string;
  message: string;
  media: MediaFile[];
  accountIds: string[];
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

  return validatePostForResolvedAccounts({
    message: params.message,
    media: params.media,
    accounts: resolvedAccounts,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
  });
}
