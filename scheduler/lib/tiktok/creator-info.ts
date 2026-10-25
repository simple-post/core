import { getTikTokErrorDetails } from "@simple-post/sdk";

import { createLogger } from "@/lib/logger";

const log = createLogger("tiktok-creator-info");

import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "./creator-info-types";

interface TikTokCreatorInfoResponse {
  data?: {
    creator_avatar_url?: string;
    creator_username?: string;
    creator_nickname?: string;
    privacy_level_options?: TikTokPrivacyLevel[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
    logid?: string;
  };
}

function creatorInfoBlockReason(code: string | null, message: string | null): string | null {
  switch (code) {
    case null:
    case "ok": {
      return null;
    }
    case "spam_risk_too_many_posts": {
      return "This TikTok account has reached its daily post cap. Try again later.";
    }
    case "spam_risk_user_banned_from_posting": {
      return "This TikTok account cannot make posts right now.";
    }
    case "reached_active_user_cap": {
      return "SimplePost has reached TikTok's active creator cap for today. Try again later.";
    }
    case "access_token_invalid": {
      return "The TikTok connection expired. Reconnect this account before posting.";
    }
    case "scope_not_authorized": {
      return "This TikTok connection is missing the video.publish permission.";
    }
    case "rate_limit_exceeded": {
      return "TikTok rate-limited the creator info check. Try again in a moment.";
    }
    default: {
      return message || "TikTok says this account cannot post right now.";
    }
  }
}

export async function fetchTikTokCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const context = { phase: "creator_info", endpoint: "/v2/post/publish/creator_info/query/", method: "POST" };
  let response: Response;
  try {
    response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    });
  } catch (error) {
    log.warn({ details: getTikTokErrorDetails(error, context, [accessToken]) }, "TikTok creator info request failed");
    throw error;
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    const failure = Object.assign(new Error("TikTok creator info response could not be read", { cause: error }), {
      response: { status: response.status, headers: Object.fromEntries(response.headers) },
    });
    log.warn(
      { details: getTikTokErrorDetails(failure, context, [accessToken]) },
      "TikTok creator info response failed",
    );
    throw new Error("TikTok creator info response could not be read");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  const data = (body && typeof body === "object" ? body : {}) as TikTokCreatorInfoResponse;
  const details = getTikTokErrorDetails(
    {
      response: {
        status: response.status,
        statusText: response.statusText,
        data: body,
        headers: Object.fromEntries(response.headers),
      },
    },
    context,
    [accessToken],
  );
  const errorCode = data.error?.code ?? (response.ok ? "ok" : "request_failed");
  const errorMessage =
    typeof details.providerMessage === "string" ? details.providerMessage : response.ok ? null : response.statusText;
  const blockReason = creatorInfoBlockReason(errorCode, errorMessage);
  if (!response.ok || errorCode !== "ok" || !data.data) {
    log.warn({ details }, "TikTok creator info request rejected or incomplete");
  }

  if (!response.ok && errorCode === "request_failed") {
    return {
      creatorAvatarUrl: null,
      creatorUsername: null,
      creatorNickname: null,
      privacyLevelOptions: [],
      commentDisabled: true,
      duetDisabled: true,
      stitchDisabled: true,
      maxVideoPostDurationSec: null,
      canPost: false,
      blockReason,
      errorCode,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    creatorAvatarUrl: data.data?.creator_avatar_url ?? null,
    creatorUsername: data.data?.creator_username ?? null,
    creatorNickname: data.data?.creator_nickname ?? null,
    privacyLevelOptions: data.data?.privacy_level_options ?? [],
    commentDisabled: data.data?.comment_disabled ?? true,
    duetDisabled: data.data?.duet_disabled ?? true,
    stitchDisabled: data.data?.stitch_disabled ?? true,
    maxVideoPostDurationSec: data.data?.max_video_post_duration_sec ?? null,
    canPost: !blockReason,
    blockReason,
    errorCode,
    fetchedAt: new Date().toISOString(),
  };
}
