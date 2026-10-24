import type { SocialPost } from "@/types";

export const TIKTOK_CAP_CODES = [
  "spam_risk_too_many_pending_share",
  "spam_risk_too_many_posts",
  "reached_active_user_cap",
  "rate_limit_exceeded",
] as const;

export type TikTokCapCode = (typeof TIKTOK_CAP_CODES)[number];

export function tikTokCapCode(value: unknown): TikTokCapCode | undefined {
  return TIKTOK_CAP_CODES.find((code) => code === value);
}

export function tikTokRecovery(code: TikTokCapCode, automatic = false) {
  const minuteLimit = code === "rate_limit_exceeded";
  const inbox = code === "spam_risk_too_many_pending_share";
  return {
    code,
    title: minuteLimit
      ? "Waiting for TikTok's request limit"
      : inbox
        ? "TikTok inbox uploads are paused"
        : "TikTok's daily limit was reached",
    message: minuteLimit
      ? "Your video is saved. Scheduled uploads wait at least one minute and retry automatically."
      : inbox
        ? "Your video is saved. Open TikTok's inbox and finish publishing the waiting uploads, or schedule another upload attempt later. TikTok does not provide an exact reset time."
        : "Your post is saved. Schedule another attempt later. TikTok's limits apply over 24 hours, so tomorrow is not a guaranteed reset.",
    state: automatic ? "waiting" : "needs_action",
    automaticRetry: automatic && minuteLimit,
    canScheduleRetry: true,
    actions: minuteLimit ? ["choose_time"] : ["retry_tomorrow", "choose_time", "spread_over_days"],
    tool: "update_scheduled_post",
    instructions:
      "Ask the user to choose or approve an exact retry time with a timezone. Call update_scheduled_post with this postId, postingMode='schedule', scheduledFor and expectedUpdatedAt. Preserve the original post; do not create a duplicate. Inbox mode schedules delivery to TikTok, where the user still finishes publishing. A scheduled retry is not a guarantee of acceptance.",
  };
}

export function recoveryForResult(
  result: { platform?: string; error?: string; details?: unknown; message?: string },
  automatic = false,
) {
  if (result.platform !== "tiktok") return undefined;
  if (!["PUBLISH_REJECTED", "LOCAL_RATE_LIMIT", "TIKTOK_ACCOUNT_PAUSED"].includes(result.error ?? "")) return undefined;
  const details = result.details as { code?: unknown; pauseCode?: unknown } | undefined;
  const code =
    tikTokCapCode(details?.pauseCode ?? details?.code) ??
    (result.error === "LOCAL_RATE_LIMIT" ? "rate_limit_exceeded" : undefined);
  return code ? tikTokRecovery(code, automatic && result.error === "LOCAL_RATE_LIMIT") : undefined;
}

/** Shared by app and MCP; never infer retry safety from a generic API error. */
export function getTikTokPostRecovery(post: Pick<SocialPost, "status" | "errorDetails" | "accountResults">) {
  if (post.status !== "failed" && post.status !== "scheduled") return undefined;
  const failures = Array.isArray(post.errorDetails?.failedPlatforms)
    ? (post.errorDetails.failedPlatforms as Array<{
        platform?: string;
        error?: string;
        details?: unknown;
        message?: string;
      }>)
    : [];
  const recoveries = failures.map((failure) => recoveryForResult(failure, post.status === "scheduled"));
  if (recoveries.length > 0 && recoveries.every(Boolean)) {
    return { ...recoveries[0]!, state: post.status === "scheduled" ? "waiting" : "needs_action" };
  }
  return undefined;
}

/** Browser-local tomorrow, including DST changes. The dialog shows the exact date before saving. */
export function tomorrowRetryTime(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}
