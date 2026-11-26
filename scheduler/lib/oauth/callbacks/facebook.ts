import { NextResponse } from "next/server";

import { FACEBOOK_NO_PAGES_MESSAGE } from "@/lib/oauth/error-messages";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import type { CallbackContext } from "@/lib/oauth/types";
import { prisma } from "@/lib/prisma";

const PENDING_OAUTH_TTL_MS = 30 * 60 * 1000;

async function fetchFacebookPages(accessToken: string) {
  const pagesResponse = await fetch(
    "https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,picture{url}",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!pagesResponse.ok) {
    throw new Error(`Failed to fetch Facebook pages: ${pagesResponse.statusText}`);
  }

  const pagesData = await pagesResponse.json();

  return (pagesData.data || []).map(
    (page: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      profilePicture: page.picture?.data?.url || null,
    }),
  );
}

export async function handleFacebookCallback(ctx: CallbackContext): Promise<NextResponse> {
  const pages = await fetchFacebookPages(ctx.accessToken);
  const reconnect = ctx.reconnectAccountId
    ? await prisma.connectedAccount.findFirst({
        where: {
          id: ctx.reconnectAccountId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? null,
          platform: ctx.platform,
        },
        select: { platformAccountId: true },
      })
    : null;
  const identity = reconnect?.platformAccountId ?? ctx.inboxIdentity;
  const accounts = identity ? pages.filter((page: { id: string }) => page.id === identity) : pages;
  if (ctx.reconnectAccountId && (!reconnect || accounts.length === 0))
    throw new OAuthCallbackError("reconnect_account_mismatch", "Choose the same account to reconnect.");

  if (accounts.length === 0) {
    return NextResponse.redirect(`${ctx.baseURL}/accounts?error=${encodeURIComponent(FACEBOOK_NO_PAGES_MESSAGE)}`);
  }

  await prisma.pendingOAuthConnection.deleteMany({
    where: { userId: ctx.userId, platform: ctx.platform, expiresAt: { lt: new Date() } },
  });
  const pending = await prisma.pendingOAuthConnection.create({
    data: {
      userId: ctx.userId,
      platform: ctx.platform,
      data: {
        accounts,
        ...(ctx.scope && { scope: ctx.scope }),
        ...(ctx.source && { source: ctx.source }),
        ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
        ...(ctx.reconnectAccountId && { reconnectAccountId: ctx.reconnectAccountId }),
      },
      expiresAt: new Date(Date.now() + PENDING_OAUTH_TTL_MS),
    },
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts/connect/${ctx.platform}?pendingId=${pending.id}`);
}
