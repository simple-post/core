import { format } from "date-fns";

import type { SocialPost } from "@/types";

import type { DraftAccountOverridesMap, PostDraftState } from "./post-draft-context";

export type ExistingPostMode = "duplicate" | "edit" | "retry";

export function normalizeDelayHours(value: number | undefined) {
  if (!Number.isFinite(value)) return 12;
  return Math.min(720, Math.max(1, Math.round(value ?? 12)));
}

export function getFailedRetryAccountIds(post: SocialPost): string[] {
  const originalAccountIds = new Set(post.accountIds);
  const failedFromAccountResults = Object.values(post.accountResults ?? {})
    .filter((result) => !result.success && originalAccountIds.has(result.accountId))
    .map((result) => result.accountId);

  if (failedFromAccountResults.length > 0) {
    return [...new Set(failedFromAccountResults)];
  }

  const failedPlatforms = Array.isArray(post.errorDetails?.failedPlatforms)
    ? (post.errorDetails.failedPlatforms as Array<{ accountId?: unknown; platform?: unknown }>)
    : [];
  const failedAccountIds = failedPlatforms
    .map((failure) => (typeof failure.accountId === "string" ? failure.accountId : null))
    .filter((accountId): accountId is string => accountId !== null && originalAccountIds.has(accountId));

  if (failedAccountIds.length > 0) {
    return [...new Set(failedAccountIds)];
  }

  return post.accountIds;
}

export function getExistingPostMode(post: SocialPost): ExistingPostMode {
  return post.status === "failed" ? "retry" : "edit";
}

/**
 * The composer draft for an existing post. Saved overrides become custom
 * content snapshots, as the composer's per-account page creates them, with
 * omitted fields filled from the shared content.
 */
export function buildExistingPostDraft(post: SocialPost, mode: ExistingPostMode): PostDraftState {
  const isCreating = mode === "duplicate";
  const accountOverrides: DraftAccountOverridesMap = Object.fromEntries(
    Object.entries(post.accountOverrides ?? {}).map(([accountId, override]) => [
      accountId,
      {
        enabled: true,
        message: override.message ?? post.message ?? "",
        media: override.media ?? post.media ?? [],
        ...(override.thread ? { thread: override.thread } : {}),
      },
    ]),
  );

  return {
    message: post.message || "",
    media: post.media || [],
    selectedAccountIds: mode === "retry" ? getFailedRetryAccountIds(post) : post.accountIds || [],
    postingMode: isCreating || mode === "retry" ? "now" : post.status === "draft" ? "draft" : "schedule",
    scheduledDate: !isCreating && post.scheduledFor ? format(post.scheduledFor, "yyyy-MM-dd") : "",
    scheduledTime: !isCreating && post.scheduledFor ? format(post.scheduledFor, "HH:mm") : "",
    accountOptions: post.accountOptions || {},
    accountOverrides,
    repostSettings: {
      enabled: post.repostEnabled === true,
      delayHours: normalizeDelayHours(post.repostDelayHours),
    },
    thread: post.thread || [],
    quotePostId: post.quotePostId ?? null,
  };
}
