import { NextResponse } from "next/server";

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
  const accounts = await fetchFacebookPages(ctx.accessToken);

  if (accounts.length === 0) {
    return NextResponse.redirect(
      `${ctx.baseURL}/accounts?error=${encodeURIComponent("No Facebook Pages found. Make sure you have a Facebook Page connected to your account.")}`,
    );
  }

  await prisma.pendingOAuthConnection.deleteMany({ where: { userId: ctx.userId, platform: ctx.platform } });

  const pending = await prisma.pendingOAuthConnection.create({
    data: {
      userId: ctx.userId,
      platform: ctx.platform,
      data: { accounts, scope: ctx.scope },
      expiresAt: new Date(Date.now() + PENDING_OAUTH_TTL_MS),
    },
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts/connect/${ctx.platform}?pendingId=${pending.id}`);
}
