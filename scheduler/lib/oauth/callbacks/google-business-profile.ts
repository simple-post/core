import { NextResponse } from "next/server";

import type { CallbackContext } from "@/lib/oauth/types";
import { prisma } from "@/lib/prisma";

import type { Prisma } from "@prisma/client";

const TTL = 30 * 60 * 1000;
export async function handleGoogleBusinessProfileCallback(ctx: CallbackContext): Promise<NextResponse> {
  const headers = { Authorization: `Bearer ${ctx.accessToken}` };
  const accountsResponse = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers });
  if (!accountsResponse.ok) throw new Error("Failed to list Google Business Profile accounts");
  const accountsData = (await accountsResponse.json()) as { accounts?: Array<{ name: string }> };
  const accounts = accountsData.accounts ?? [];
  const locations: Array<Record<string, unknown>> = [];
  for (const account of accounts) {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
    url.searchParams.set("readMask", "name,title,metadata");
    url.searchParams.set("pageSize", "100");
    const response = await fetch(url, { headers });
    if (!response.ok) continue;
    const data = await response.json();
    for (const location of data.locations ?? [])
      if (location.metadata?.canOperateLocalPost !== false)
        locations.push({
          id: `${account.name}/${location.name}`,
          name: location.title || location.name,
          accessToken: ctx.accessToken,
          refreshToken: ctx.refreshToken,
          expiresIn: ctx.expiresIn,
          tokenMetadata: ctx.tokenMetadata,
        });
  }
  if (locations.length === 0)
    return NextResponse.redirect(
      `${ctx.baseURL}/accounts?error=${encodeURIComponent("No eligible Google Business Profile locations found.")}`,
    );
  await prisma.pendingOAuthConnection.deleteMany({ where: { userId: ctx.userId, platform: ctx.platform } });
  const pending = await prisma.pendingOAuthConnection.create({
    data: {
      userId: ctx.userId,
      platform: ctx.platform,
      data: { accounts: locations, scope: ctx.scope } as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + TTL),
    },
  });
  return NextResponse.redirect(`${ctx.baseURL}/accounts/connect/${ctx.platform}?pendingId=${pending.id}`);
}
