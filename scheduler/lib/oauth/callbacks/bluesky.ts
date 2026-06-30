import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import type { CallbackContext } from "@/lib/oauth/types";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

import type { Prisma } from "@prisma/client";

const BLUESKY_OAUTH_ISSUER = process.env.BLUESKY_OAUTH_ISSUER || "https://bsky.social";

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

async function fetchBlueskyProfile(did: string) {
  const config = getPlatformOAuthConfig("bluesky")!;
  if (!config.userInfoUrl) {
    throw new Error("Bluesky profile endpoint is not configured");
  }

  const url = new URL(config.userInfoUrl);
  url.searchParams.set("actor", did);

  const response = await fetch(url.toString());
  if (!response.ok) {
    authLogger.error({ status: response.status }, "Failed to fetch Bluesky profile");
    throw new Error("Failed to fetch Bluesky profile");
  }

  return response.json();
}

async function fetchBlueskyPdsUrl(did: string): Promise<string | null> {
  try {
    const response = await fetch(`https://plc.directory/${did}`);
    if (!response.ok) return null;
    const data = await response.json();
    const services = Array.isArray(data.service) ? data.service : [];
    const pdsService = services.find(
      (service: { id?: string; type?: string }) =>
        service.id === "#atproto_pds" || service.type === "AtprotoPersonalDataServer",
    );
    return pdsService?.serviceEndpoint || null;
  } catch (error) {
    authLogger.warn({ error }, "Failed to resolve Bluesky PDS URL");
    return null;
  }
}

export async function handleBlueskyCallback(ctx: CallbackContext): Promise<NextResponse> {
  const config = getPlatformOAuthConfig("bluesky")!;
  const payload = decodeJwtPayload(ctx.accessToken);
  const did = (ctx.tokenData.sub as string | undefined) || (payload?.sub as string | undefined);

  if (!did) {
    throw new Error("No Bluesky DID received");
  }

  const profile = await fetchBlueskyProfile(did);
  const pdsUrl = (await fetchBlueskyPdsUrl(did)) || BLUESKY_OAUTH_ISSUER;

  let tokenMetadata: Prisma.InputJsonValue | undefined;
  if (ctx.tokenMetadata && typeof ctx.tokenMetadata === "object" && !Array.isArray(ctx.tokenMetadata)) {
    tokenMetadata = {
      ...ctx.tokenMetadata,
      clientId: config.clientId,
      pdsUrl,
      tokenUrl: config.tokenUrl,
    } as Prisma.InputJsonValue;
  }

  await upsertConnectedAccount({
    userId: ctx.userId,
    platform: "bluesky",
    platformAccountId: did,
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken,
    expiresAt: ctx.expiresIn ? new Date(Date.now() + ctx.expiresIn * 1000) : null,
    scope: ctx.scope ?? null,
    username: profile.handle || null,
    displayName: profile.displayName || profile.handle || null,
    email: null,
    profilePicture: profile.avatar || null,
    tokenMetadata,
  });

  return NextResponse.redirect(`${ctx.baseURL}/accounts?success=true&platform=bluesky`);
}
