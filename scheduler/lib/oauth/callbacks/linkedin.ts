import { NextResponse } from "next/server";

import { authLogger } from "@/lib/logger";
import { extractProfileData } from "@/lib/oauth/callbacks/generic";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { fetchLinkedInPages, fetchLinkedInMemberProfile } from "@/lib/oauth/linkedin-pages";
import type { CallbackContext } from "@/lib/oauth/types";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

export async function handleLinkedInCallback(ctx: CallbackContext): Promise<NextResponse> {
  const profile = await fetchLinkedInMemberProfile(ctx.accessToken);
  if (!profile.sub) throw new Error("LinkedIn did not return a member ID. Please reconnect.");
  const member = await extractProfileData("linkedin", profile, ctx.tokenData);

  const scope = ctx.scope ?? getPlatformOAuthConfig("linkedin")!.scope;
  const expiresAt = ctx.expiresIn ? new Date(Date.now() + ctx.expiresIn * 1000).toISOString() : null;
  const tokenMetadata =
    typeof ctx.tokenMetadata === "object" && !Array.isArray(ctx.tokenMetadata) ? ctx.tokenMetadata : {};
  const credentials = encryptConnectedAccountSecrets({
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken,
    tokenMetadata: { ...tokenMetadata, linkedinMemberId: profile.sub },
  });
  const accounts = [
    {
      id: profile.sub,
      name: member.displayName || "LinkedIn profile",
      username: member.username,
      email: member.email,
      profilePicture: member.profilePicture,
      accountType: "profile",
      expiresAt,
      ...credentials,
    },
  ];
  let warning: string | undefined;
  try {
    if (!scope.split(/[ ,]+/).includes("w_organization_social")) {
      throw new Error("LinkedIn Page posting permission was not granted. Reconnect and grant Page access.");
    }
    const pages = await fetchLinkedInPages(ctx.accessToken, profile.sub);
    accounts.push(
      ...pages.map((page) => ({ ...page, email: null, accountType: "organization", expiresAt, ...credentials })),
    );
    if (pages.length === 0)
      warning =
        "No company Pages available for publishing. Check that your LinkedIn account has permission to create Page posts, then reconnect.";
  } catch (error) {
    authLogger.warn({ userId: ctx.userId }, "LinkedIn Page discovery failed");
    warning = error instanceof Error ? error.message : "Unable to load LinkedIn Pages. Please reconnect.";
  }

  await prisma.pendingOAuthConnection.deleteMany({ where: { userId: ctx.userId, platform: "linkedin" } });
  const pending = await prisma.pendingOAuthConnection.create({
    data: {
      userId: ctx.userId,
      platform: "linkedin",
      data: { accounts, scope, ...(warning ? { warning } : {}) },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  return NextResponse.redirect(`${ctx.baseURL}/accounts/connect/linkedin?pendingId=${pending.id}`);
}
