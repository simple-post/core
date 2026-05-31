export type TikTokPrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string | null;
  creatorUsername: string | null;
  creatorNickname: string | null;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
  canPost: boolean;
  blockReason: string | null;
  errorCode: string | null;
  fetchedAt: string;
}

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
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });

  const data = (await response.json().catch(() => ({}))) as TikTokCreatorInfoResponse;
  const errorCode = data.error?.code ?? (response.ok ? "ok" : "request_failed");
  const errorMessage = data.error?.message ?? (response.ok ? null : response.statusText);
  const blockReason = creatorInfoBlockReason(errorCode, errorMessage);

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
