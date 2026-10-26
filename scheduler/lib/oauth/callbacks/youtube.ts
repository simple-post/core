import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount, type UpsertAccountData } from "@/lib/oauth/upsert";
import { fetchYouTubeChannel } from "@/lib/oauth/youtube-channel";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

async function findVerifiedLegacyIdentity(userId: string, channelId: string) {
  const accounts = await prisma.connectedAccount.findMany({ where: { userId, platform: "youtube" } });
  if (accounts.some((account) => account.platformAccountId === channelId)) return undefined;

  let previousIdentity: UpsertAccountData["previousIdentity"];
  // Older connections used Google's numeric profile ID. Verify their actual channel
  // with their own credentials before preserving the row and its scheduled posts.
  for (const stored of accounts.filter((account) => /^\d+$/.test(account.platformAccountId))) {
    try {
      const result = await refreshConnectedAccountIfNeeded(decryptConnectedAccountSecrets(stored));
      if (result.error) continue;
      const channel = await fetchYouTubeChannel(result.account.accessToken);
      if (channel.platformAccountId !== channelId) continue;
      // Multiple legacy rows cannot be merged safely without deciding which posts to move.
      if (previousIdentity) return undefined;
      previousIdentity = {
        platformAccountId: result.account.platformAccountId,
        updatedAt: result.account.updatedAt,
      };
    } catch {
      authLogger.warn({ accountId: stored.id }, "Could not verify legacy YouTube channel identity");
    }
  }
  return previousIdentity;
}

export async function handleYouTubeCallback(ctx: CallbackContext): Promise<NextResponse> {
  const channel = await fetchYouTubeChannel(ctx.accessToken);
  const previousIdentity = await findVerifiedLegacyIdentity(ctx.userId, channel.platformAccountId);

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: "youtube",
    ...channel,
    email: null,
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken,
    expiresAt: ctx.expiresIn ? new Date(Date.now() + ctx.expiresIn * 1000) : null,
    scope: ctx.scope ?? null,
    tokenMetadata: ctx.tokenMetadata ?? undefined,
    ...(previousIdentity ? { previousIdentity } : {}),
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts?success=true&platform=youtube`);
}
