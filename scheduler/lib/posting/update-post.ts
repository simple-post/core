import { IMAGE_FIT_HELP } from "@simple-post/sdk";

import { getTrialExpiryScheduleWarning } from "@/lib/billing/schedule-warning";
import {
  assertCanCreatePost,
  getBillingStatus,
  lockUserForQuota,
  toBillingSocialAccounts,
} from "@/lib/billing/subscriptions";
import { getChargedTrialAccounts } from "@/lib/billing/trial";
import { PostsModel } from "@/lib/db";
import { ingestPostMedia } from "@/lib/media-ingestion";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import type { PostingResultCallback } from "@/lib/posting";
import { mergeAccountResults } from "@/lib/posting/account-results";
import { sanitizePostingResult } from "@/lib/posting/progress-stream";
import { longestThreadLength } from "@/lib/posting/thread-length";
import { prisma } from "@/lib/prisma";
import { validateQuoteSource } from "@/lib/quote/source";
import { buildQuoteTargets } from "@/lib/quote/targets";
import { buildPublishedRepostState, normalizeRepostSettings } from "@/lib/repost/settings";
import { NotFoundError, ConflictError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { deleteMediaFiles, deleteStorageUrls, getRemovedAccountOptionThumbnailUrls } from "@/lib/utils/media-cleanup";
import { queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { requiredDraftImageFittingErrors } from "@/lib/validation/draft-image-fitting";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { updatePostSchema } from "@/lib/validations/posts";
import {
  SCHEDULED_TIME_PAST_MESSAGE,
  getScheduledForValueError,
  parseScheduledForValue,
} from "@/lib/validations/scheduled-time";
import { dispatchPostWebhooks } from "@/lib/webhooks";
import type { AccountResultsMap, MediaFile, PostingMode, ThreadSegmentResult } from "@/types";

function resolveScheduledFor(
  postingMode: PostingMode,
  scheduledForValue?: string,
  currentScheduledFor?: Date | null,
): Date | null {
  if (postingMode === "draft") {
    return null;
  }

  if (postingMode === "now") {
    return new Date();
  }

  if (!scheduledForValue) {
    if (currentScheduledFor) {
      if (currentScheduledFor <= new Date()) {
        throw new BadRequestError(SCHEDULED_TIME_PAST_MESSAGE);
      }
      return currentScheduledFor;
    }
    throw new BadRequestError("Choose a date and time before scheduling this post.");
  }

  const scheduledForError = getScheduledForValueError(scheduledForValue);
  if (scheduledForError) {
    throw new BadRequestError(scheduledForError);
  }

  return parseScheduledForValue(scheduledForValue)!;
}

async function getScheduleWarnings(userId: string, scheduledFor: Date | null) {
  if (!scheduledFor) return [];
  const warning = getTrialExpiryScheduleWarning(await getBillingStatus(userId), scheduledFor);
  return warning ? [warning] : [];
}

export async function executePostUpdate(
  userId: string,
  id: string,
  body: unknown,
  onPostingResult?: PostingResultCallback,
) {
  const repository = new PostsModel(userId);

  // Get the current post
  const currentPost = await repository.getPostById(id);
  if (!currentPost) {
    throw new NotFoundError("Post not found");
  }
  if (currentPost.status !== "scheduled" && currentPost.status !== "draft" && currentPost.status !== "failed") {
    throw new BadRequestError("Only scheduled posts, drafts and failed posts can be edited");
  }

  // Parse and validate body
  let validated = updatePostSchema.parse(body);
  if (validated.expectedUpdatedAt && validated.expectedUpdatedAt !== currentPost.updatedAt.toISOString()) {
    throw new ConflictError("This post changed. Reload it before saving or publishing.");
  }
  const isRetry = currentPost.status === "failed";
  if (isRetry) {
    if (validated.accountIds.some((accountId) => !currentPost.accountIds.includes(accountId)))
      throw new BadRequestError("A retry cannot add accounts. Duplicate the post to target new accounts.");
    const checkpoints = await prisma.publishCheckpoint.count({ where: { postId: id } });
    const safelyUnattempted = currentPost.accountIds.every((accountId) =>
      ["CREDENTIALS_ERROR", "ACCOUNT_NOT_FOUND", "LOCAL_RATE_LIMIT"].includes(
        currentPost.accountResults?.[accountId]?.error ?? "",
      ),
    );
    if (!checkpoints && !safelyUnattempted)
      throw new BadRequestError(
        "This post has no durable publishing record. Check its platform results, then explicitly duplicate only the content that still needs publishing.",
      );
  }
  validated = await ingestPostMedia(userId, validated, {
    onUploaded: async (url) => {
      await prisma.$transaction((tx) => queueStorageDeletion(tx, userId, url));
    },
  });
  const currentPostingMode: PostingMode = currentPost.status === "draft" ? "draft" : "schedule";
  const postingMode = validated.postingMode ?? (validated.scheduledFor ? "schedule" : currentPostingMode);
  const scheduledFor = resolveScheduledFor(postingMode, validated.scheduledFor, currentPost.scheduledFor);
  const scheduleWarnings = await getScheduleWarnings(userId, postingMode === "schedule" ? scheduledFor : null);
  const quotePostId = validated.quotePostId === undefined ? currentPost.quotePostId : validated.quotePostId;
  const quoteSource = await validateQuoteSource({
    userId: userId,
    quotePostId: quotePostId ?? undefined,
    postingMode,
    scheduledFor,
    currentPostId: id,
  });

  // Media is already uploaded to R2, just use the provided array
  const finalMedia: MediaFile[] = validated.media || [];

  const validation = await validatePostForAccounts({
    checkAccountReadiness: postingMode !== "draft",
    imageFit: validated.imageFit,
    userId: userId,
    message: validated.message,
    media: finalMedia,
    accountIds: validated.accountIds,
    accountOptions: validated.accountOptions,
    accountOverrides: validated.accountOverrides,
    thread: validated.thread,
  });

  if (validation.accounts.length !== validated.accountIds.length) {
    throw new BadRequestError("One or more accounts were not found");
  }

  const draftImageErrors = await requiredDraftImageFittingErrors({
    errors: validation.summary.errors,
    postingMode,
    userId: userId,
  });
  if ((postingMode !== "draft" && !validation.summary.isValid) || draftImageErrors.length > 0) {
    throw new ValidationError(
      draftImageErrors.length > 0 ? { ...validation, imageFitHelp: IMAGE_FIT_HELP } : validation,
      draftImageErrors.length > 0
        ? `The draft contains images that must be fitted before it can be saved. ${IMAGE_FIT_HELP}`
        : undefined,
    );
  }

  if (postingMode !== "draft" && scheduledFor) {
    const credentialIssues = await getCredentialIssuesForPublishTime({
      accountIds: validated.accountIds,
      publishAt: scheduledFor,
      userId: userId,
    });
    if (credentialIssues.length > 0) {
      throw new BadRequestError(credentialIssues.map((issue) => issue.message).join(" "));
    }
  }

  // A draft consumed no allowance when it was created, so leaving draft state
  // is where it gets charged. An already scheduled post has paid for the
  // accounts it currently targets, so only newly added ones cost anything.
  const previousAccounts = ["scheduled", "failed"].includes(currentPost.status)
    ? await prisma.connectedAccount.findMany({
        where: { userId: userId, id: { in: currentPost.accountIds } },
        select: { id: true, platform: true },
      })
    : [];
  const replacingSocialAccounts = getChargedTrialAccounts({ ...currentPost, accounts: previousAccounts });

  const repostSettings = validated.repost
    ? normalizeRepostSettings(validated.repost)
    : normalizeRepostSettings({
        enabled: currentPost.repostEnabled,
        delayHours: currentPost.repostDelayHours,
      });

  // Capture removed media before update for R2 cleanup. Include media from
  // every thread segment in the comparison, otherwise removing a segment
  // would orphan its media in R2.
  // Account overrides can reference the same objects (a custom thread is
  // seeded from the common one), so their media counts as kept too.
  const keptMedia = [
    ...finalMedia,
    ...(validated.thread ?? []).flatMap((s) => s.media ?? []),
    ...Object.values(validated.accountOverrides ?? {}).flatMap((override) => [
      ...(override.media ?? []),
      ...(override.thread ?? []).flatMap((s) => s.media ?? []),
    ]),
  ];
  const newMediaUrls = new Set(keptMedia.map((m) => m.url));
  const newMediaThumbnailUrls = new Set(
    keptMedia.map((m) => m.thumbnailUrl).filter((url): url is string => typeof url === "string"),
  );
  const oldThreadMedia = (currentPost.thread ?? []).flatMap((s) => s.media ?? []);
  const removedMedia = [...currentPost.media, ...oldThreadMedia].filter((m) => !newMediaUrls.has(m.url));
  const removedAccountOptionThumbnailUrls = getRemovedAccountOptionThumbnailUrls(
    currentPost.accountOptions,
    validated.accountOptions,
  ).filter((url) => !newMediaUrls.has(url) && !newMediaThumbnailUrls.has(url));

  // Update the post
  const post = await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, userId);
    await assertCanCreatePost(userId, tx, {
      action: `update_${postingMode}_post`,
      postId: id,
      socialAccounts: toBillingSocialAccounts(validation.accounts),
      replacingSocialAccounts,
      threadSegments: longestThreadLength(validated.accountIds, validated.thread, validated.accountOverrides),
      isDraft: postingMode === "draft",
      isExistingPostUpdate: currentPost.status !== "draft",
    });
    return repository.updatePost(
      id,
      {
        message: validated.message,
        accountIds: isRetry ? currentPost.accountIds : validated.accountIds,
        scheduledFor,
        status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
        errorMessage: null,
        errorDetails: null,
        publishedAt: null,
        threadResults: isRetry ? currentPost.threadResults : null,
        accountResults: isRetry ? currentPost.accountResults : null,
        accountOptions: validated.accountOptions,
        accountOverrides: validated.accountOverrides,
        repostEnabled: repostSettings.enabled,
        repostDelayHours: repostSettings.delayHours,
        repostDueAt: null,
        repostStatus: "not_applicable",
        repostedAt: null,
        repostResults: null,
        repostErrorMessage: null,
        repostErrorDetails: null,
        media: finalMedia,
        thread: validated.thread,
        quotePostId,
      },
      { status: currentPost.status, updatedAt: currentPost.updatedAt },
      tx,
    );
  });

  // Clean up removed media from R2 (best-effort, don't fail the request)
  if (removedMedia.length > 0) {
    await deleteMediaFiles(userId, removedMedia);
  }
  if (removedAccountOptionThumbnailUrls.length > 0) {
    await deleteStorageUrls(userId, removedAccountOptionThumbnailUrls, "removed-account-option-thumbnail");
  }

  if (postingMode !== "now") {
    return {
      post,
      warnings: scheduleWarnings,
    };
  }

  try {
    const quoteTargets = quoteSource ? buildQuoteTargets(quoteSource, validation.accounts) : undefined;
    const results = await postToAccounts(
      userId,
      validated.message,
      finalMedia,
      validated.accountIds,
      validated.accountOptions,
      validated.accountOverrides,
      validated.thread,
      quoteTargets,
      onPostingResult,
      { postId: post.id, source: "api" },
    );
    const summary = getPostingSummary(results);

    const threadResultsByAccount: Record<string, ThreadSegmentResult[]> = isRetry
      ? { ...currentPost.threadResults }
      : {};
    for (const result of results) {
      if (result.threadResults) threadResultsByAccount[result.accountId] = result.threadResults;
    }
    const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;
    const accountResults = sanitizeForJson(
      mergeAccountResults(isRetry ? (currentPost.accountResults ?? undefined) : undefined, results),
    ) as AccountResultsMap;

    if (
      summary.overallSuccess &&
      currentPost.accountIds.every((accountId) => accountResults[accountId]?.success || !isRetry)
    ) {
      const publishedAt = new Date();
      const repostState = buildPublishedRepostState({
        enabled: repostSettings.enabled,
        delayHours: repostSettings.delayHours,
        accountResults,
        publishedAt,
      });
      await repository.updatePost(post.id, {
        status: "published",
        publishedAt,
        threadResults: hasThreadResults ? threadResultsByAccount : undefined,
        accountResults,
        repostDueAt: repostState.repostDueAt,
        repostStatus: repostState.repostStatus,
        repostResults: null,
        repostErrorMessage: null,
        repostErrorDetails: null,
      });
      await dispatchPostWebhooks(userId, "post.published", {
        id: post.id,
        status: "published",
        message: validated.message,
        publishedAt: publishedAt.toISOString(),
        accountResults,
      });
    } else {
      const failedResults = results.filter((result) => !result.success);
      const errorMessage =
        failedResults.length === 1
          ? failedResults[0].message || failedResults[0].error || "Unknown error"
          : failedResults.length > 0
            ? `Failed on ${failedResults.length} platform(s)`
            : "Some accounts still need publishing";
      const errorDetails = sanitizeForJson({
        failedPlatforms: failedResults.map((result) => ({
          accountId: result.accountId,
          platform: result.platform,
          error: result.error,
          message: result.message,
          details: result.details,
          threadResults: result.threadResults,
        })),
      }) as Record<string, unknown>;

      await repository.updatePost(post.id, {
        status: "failed",
        errorMessage,
        errorDetails,
        threadResults: hasThreadResults ? threadResultsByAccount : undefined,
        accountResults,
        repostDueAt: null,
        repostStatus: "not_applicable",
      });
      await dispatchPostWebhooks(userId, "post.failed", {
        id: post.id,
        status: "failed",
        message: validated.message,
        errorMessage,
        accountResults,
      });
    }

    const updatedPost = await repository.getPostById(post.id);
    const sanitizedResults = results.map((result) => sanitizePostingResult(result));

    return {
      post: updatedPost,
      postingResults: sanitizedResults,
      summary,
    };
  } catch (postingError) {
    const errorMessage = postingError instanceof Error ? postingError.message : "Unknown error during posting";
    const errorDetails = {
      error: postingError instanceof Error ? postingError.message : String(postingError),
      stack: postingError instanceof Error ? postingError.stack : undefined,
    };

    await repository.updatePost(post.id, {
      status: "failed",
      errorMessage,
      errorDetails,
      repostDueAt: null,
      repostStatus: "not_applicable",
    });

    throw new BadRequestError("Failed to post to platforms");
  }
}
