import { prisma } from "@/lib/prisma";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";
import type { ThreadSegment } from "@simple-post/sdk";

export async function validatePostForAccounts(params: {
  userId: string;
  message: string;
  media: MediaFile[];
  accountIds: string[];
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
  accountOptions?: AccountOptionsMap;
}): Promise<ValidationResultByPlatform> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      userId: params.userId,
      id: { in: params.accountIds },
    },
  });

  return validatePostForResolvedAccounts({
    message: params.message,
    media: params.media,
    accounts,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
    accountOptions: params.accountOptions,
  });
}
