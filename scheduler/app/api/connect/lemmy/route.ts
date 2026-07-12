import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const instanceUrl = typeof body.instanceUrl === "string" ? body.instanceUrl.trim().replace(/\/$/, "") : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const communityId = Number(body.communityId);
    const apiVersion = body.apiVersion === "v4" ? "v4" : "v3";
    if (!instanceUrl || !username || !password || !Number.isInteger(communityId) || communityId <= 0)
      throw new BadRequestError("Instance, username, password, and community ID are required");
    const path = apiVersion === "v4" ? "/api/v4/account/auth/login" : "/api/v3/user/login";
    const response = await fetch(`${instanceUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.jwt) throw new BadRequestError(data.error || "Lemmy login failed");
    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "lemmy",
      platformAccountId: `${instanceUrl}#${username}`,
      accessToken: data.jwt,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      username,
      displayName: `${username}@${new URL(instanceUrl).host}`,
      email: null,
      profilePicture: null,
      tokenMetadata: { instanceUrl, communityId, apiVersion },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
