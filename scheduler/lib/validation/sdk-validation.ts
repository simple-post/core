import fs from "node:fs";

import {
  downloadToTempFile,
  TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES,
  TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES,
} from "@simple-post/sdk";

import { isPreviewOnlyTokenMetadata } from "@/lib/accounts/account-state";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata } from "@/lib/security/connected-account-secrets";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";
import type { ThreadSegment } from "@simple-post/sdk";

function telegramMediaLimit(media: MediaFile): number {
  return media.type === "image" ? TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES : TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES;
}

function telegramMediaForValidation(
  params: Pick<Parameters<typeof validatePostForAccounts>[0], "media" | "accountOverrides" | "thread">,
  accounts: ConnectedAccount[],
): MediaFile[] {
  const candidates = new Set<MediaFile>();
  const sharedThread = params.thread ?? [];

  for (const account of accounts) {
    if (account.platform !== "telegram") continue;

    const override = params.accountOverrides?.[account.id];
    for (const item of override?.media ?? params.media) candidates.add(item);
    for (const segment of override?.thread ?? sharedThread) {
      for (const item of segment.media ?? []) candidates.add(item);
    }
  }

  return [...candidates];
}

async function hydrateUnknownTelegramMediaSizes(
  params: Pick<Parameters<typeof validatePostForAccounts>[0], "media" | "accountOverrides" | "thread">,
  accounts: ConnectedAccount[],
): Promise<void> {
  const sizeBySource = new Map<string, Promise<number>>();

  await Promise.all(
    telegramMediaForValidation(params, accounts).map(async (media) => {
      if (media.size > 0) return;

      const limit = telegramMediaLimit(media);
      const cacheKey = `${media.type}:${media.url}`;
      let sizePromise = sizeBySource.get(cacheKey);
      if (!sizePromise) {
        sizePromise = (async () => {
          let tempPath: string | undefined;
          try {
            tempPath = await downloadToTempFile(media.url, undefined, limit);
            return fs.statSync(tempPath).size;
          } catch (error) {
            if (error instanceof Error && error.message.includes("exceeds the maximum download size")) {
              // The exact size is irrelevant once it is known to exceed the
              // platform limit. Preserve a structured validation error.
              return limit + 1;
            }
            throw new Error(
              `SimplePost couldn't inspect Telegram media at ${media.url}: ${
                error instanceof Error ? error.message : "Unknown download error"
              }`,
            );
          } finally {
            if (tempPath) {
              try {
                fs.unlinkSync(tempPath);
              } catch {
                // Best-effort cleanup; validation must not fail because a
                // temporary file was already removed.
              }
            }
          }
        })();
        sizeBySource.set(cacheKey, sizePromise);
      }

      media.size = await sizePromise;
    }),
  );
}

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

  // MCP and external-URL callers may not know a media file's byte size and
  // represent it as 0. Telegram publishing now uses multipart uploads, so
  // resolve those unknown sizes against the 10/50 MiB limits before a post
  // can be scheduled or published. The objects are updated in place so the
  // measured size is persisted by create/update callers after validation.
  await hydrateUnknownTelegramMediaSizes(params, resolvedAccounts);

  return validatePostForResolvedAccounts({
    message: params.message,
    media: params.media,
    accounts: resolvedAccounts,
    accountOverrides: params.accountOverrides,
    thread: params.thread,
  });
}
