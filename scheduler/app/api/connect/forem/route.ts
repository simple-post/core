import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { fetchForem, normalizeForemInstanceUrl } from "@/lib/security/forem";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const rawInstanceUrl = (typeof body.instanceUrl === "string" ? body.instanceUrl.trim() : "") || "https://dev.to";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) throw new BadRequestError("Forem API key is required");
    let instanceUrl: string;
    try {
      instanceUrl = normalizeForemInstanceUrl(rawInstanceUrl);
    } catch {
      throw new BadRequestError("Instance URL must be a public https:// origin");
    }
    let response: Response;
    try {
      response = await fetchForem(instanceUrl, "/api/users/me", {
        headers: { "api-key": apiKey, Accept: "application/vnd.forem.api-v1+json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadRequestError("Could not reach the Forem instance");
    }
    const user = await response.json().catch(() => ({}));
    if (!response.ok || !user.id || !user.username)
      throw new BadRequestError(user.error || "Forem rejected this API key");
    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "forem",
      platformAccountId: `${instanceUrl}#${user.id}`,
      accessToken: apiKey,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      username: user.username,
      displayName: user.name || user.username,
      email: null,
      profilePicture: user.profile_image || null,
      tokenMetadata: { instanceUrl },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
