import { type NextRequest, NextResponse } from "next/server";

import { handoffSource } from "@/lib/accounts/assistant-handoff";
import { measurementFailure, recordFunnelEvent } from "@/lib/analytics/events";
import { getPlatformById, isSocialPlatformEnabled } from "@/lib/config";
import { requireAuth } from "@/lib/middleware/auth";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export async function POST(request: NextRequest) {
  let measurementUserId: string | null = null;
  let measurementPlatform = "unknown";
  try {
    const session = await requireAuth(request, { action: "connect_social_account_handoff" });
    measurementUserId = session.user.id;
    const { platform, handoffToken } = await request.json();
    if (typeof platform !== "string" || !isSocialPlatformEnabled(platform))
      throw new BadRequestError("This platform is not available for connection.");
    measurementPlatform = platform;
    const config = getPlatformById(platform);
    if (!config || config.id !== platform) throw new BadRequestError("This platform is not available for connection.");
    const source = handoffSource(handoffToken ?? "", session.user.id, platform);
    if (config.connectionType !== "manual" && !getPlatformOAuthConfig(platform)?.clientId)
      throw new BadRequestError("This platform is not configured for connection.");
    await recordFunnelEvent(session.user.id, "social_connection_link_opened", {
      key: `assistant-link:${handoffToken}`,
      properties: { platform, source },
    });
    return NextResponse.json(
      {
        connectionType: config.connectionType,
        ...(config.connectionType === "oauth" && {
          startUrl: `/api/connect/${platform}?handoffToken=${encodeURIComponent(handoffToken)}`,
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (measurementUserId)
      await recordFunnelEvent(measurementUserId, "social_connection_failed", {
        properties: {
          platform: measurementPlatform,
          source: "assistant_handoff",
          entrypoint: "handoff_validation",
          reason: measurementFailure(error),
        },
      });
    return handleApiError(error, request);
  }
}
