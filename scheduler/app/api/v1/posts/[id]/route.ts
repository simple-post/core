import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { assertNoUnresolvedQuotes, validateQuoteSource } from "@/lib/quote/source";
import { buildQuoteTargets } from "@/lib/quote/targets";
import { buildPublishedRepostState, normalizeRepostSettings } from "@/lib/repost/settings";
import { handleApiError, NotFoundError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import {
  deleteAccountOptionFiles,
  deleteMediaFiles,
  deleteStorageUrls,
  getRemovedAccountOptionThumbnailUrls,
} from "@/lib/utils/media-cleanup";
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

// GET /api/v1/posts/[id] - Get a single post by ID
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    const post = await repository.getPostById(id);
    if (!post) {
      throw new NotFoundError("Post not found");
    }

    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/v1/posts/[id] - Update a post
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    // Get the current post
    const currentPost = await repository.getPostById(id);
    if (!currentPost) {
      throw new NotFoundError("Post not found");
    }
    if (currentPost.status !== "scheduled" && currentPost.status !== "draft") {
      throw new BadRequestError("Only scheduled posts and drafts can be edited");
    }

    // Parse and validate body
    const body = await req.json();
    const validated = updatePostSchema.parse(body);
    const currentPostingMode: PostingMode = currentPost.status === "draft" ? "draft" : "schedule";
    const postingMode = validated.postingMode ?? (validated.scheduledFor ? "schedule" : currentPostingMode);
    const scheduledFor = resolveScheduledFor(postingMode, validated.scheduledFor, currentPost.scheduledFor);
    const quotePostId = validated.quotePostId === undefined ? currentPost.quotePostId : validated.quotePostId;
    const quoteSource = await validateQuoteSource({
      userId: session.user.id,
      quotePostId: quotePostId ?? undefined,
      postingMode,
      scheduledFor,
      currentPostId: id,
    });

    // Media is already uploaded to R2, just use the provided array
    const finalMedia: MediaFile[] = validated.media || [];

    const validation = await validatePostForAccounts({
      userId: session.user.id,
      message: validated.message,
      media: finalMedia,
      accountIds: validated.accountIds,
      accountOverrides: validated.accountOverrides,
      thread: validated.thread,
    });

    if (validation.accounts.length !== validated.accountIds.length) {
      throw new BadRequestError("One or more accounts were not found");
    }

    if (postingMode !== "draft" && !validation.summary.isValid) {
      throw new ValidationError(validation);
    }

    if (postingMode !== "draft" && scheduledFor) {
      const credentialIssues = await getCredentialIssuesForPublishTime({
        accountIds: validated.accountIds,
        publishAt: scheduledFor,
        userId: session.user.id,
      });
      if (credentialIssues.length > 0) {
        throw new BadRequestError(credentialIssues.map((issue) => issue.message).join(" "));
      }
    }

    const repostSettings = validated.repost
      ? normalizeRepostSettings(validated.repost)
      : normalizeRepostSettings({
          enabled: currentPost.repostEnabled,
          delayHours: currentPost.repostDelayHours,
        });

    // Capture removed media before update for R2 cleanup. Include media from
    // every thread segment in the comparison, otherwise removing a segment
    // would orphan its media in R2.
    const newMediaUrls = new Set([
      ...finalMedia.map((m) => m.url),
      ...(validated.thread ?? []).flatMap((s) => (s.media ?? []).map((m) => m.url)),
    ]);
    const newMediaThumbnailUrls = new Set([
      ...finalMedia.map((m) => m.thumbnailUrl).filter((url): url is string => typeof url === "string"),
      ...(validated.thread ?? []).flatMap((s) =>
        (s.media ?? []).map((m) => m.thumbnailUrl).filter((url): url is string => typeof url === "string"),
      ),
    ]);
    const oldThreadMedia = (currentPost.thread ?? []).flatMap((s) => s.media ?? []);
    const removedMedia = [...currentPost.media, ...oldThreadMedia].filter((m) => !newMediaUrls.has(m.url));
    const removedAccountOptionThumbnailUrls = getRemovedAccountOptionThumbnailUrls(
      currentPost.accountOptions,
      validated.accountOptions,
    ).filter((url) => !newMediaUrls.has(url) && !newMediaThumbnailUrls.has(url));

    // Update the post
    const post = await repository.updatePost(id, {
      message: validated.message,
      accountIds: validated.accountIds,
      scheduledFor,
      status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
      errorMessage: null,
      errorDetails: null,
      publishedAt: null,
      threadResults: null,
      accountResults: null,
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
    });

    // Clean up removed media from R2 (best-effort, don't fail the request)
    if (removedMedia.length > 0) {
      await deleteMediaFiles(session.user.id, removedMedia);
    }
    if (removedAccountOptionThumbnailUrls.length > 0) {
      await deleteStorageUrls(session.user.id, removedAccountOptionThumbnailUrls, "removed-account-option-thumbnail");
    }

    if (postingMode !== "now") {
      return NextResponse.json({ post });
    }

    try {
      const quoteTargets = quoteSource ? buildQuoteTargets(quoteSource, validation.accounts) : undefined;
      const results = await postToAccounts(
        session.user.id,
        validated.message,
        finalMedia,
        validated.accountIds,
        validated.accountOptions,
        validated.accountOverrides,
        validated.thread,
        quoteTargets,
      );
      const summary = getPostingSummary(results);

      const threadResultsByAccount: Record<string, ThreadSegmentResult[]> = {};
      for (const result of results) {
        if (result.threadResults) threadResultsByAccount[result.accountId] = result.threadResults;
      }
      const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;
      const accountResults = sanitizeForJson(toAccountResultsMap(results)) as AccountResultsMap;

      if (summary.overallSuccess) {
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
        await dispatchPostWebhooks(session.user.id, "post.published", {
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
            : `Failed on ${failedResults.length} platform(s)`;
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
        await dispatchPostWebhooks(session.user.id, "post.failed", {
          id: post.id,
          status: "failed",
          message: validated.message,
          errorMessage,
          accountResults,
        });
      }

      const updatedPost = await repository.getPostById(post.id);
      const sanitizedResults = results.map((result) => ({
        accountId: result.accountId,
        platform: result.platform,
        success: result.success,
        error: result.error,
        message: result.message,
        postId: result.postId,
        postUrl: result.postUrl,
        details: result.details ? (sanitizeForJson(result.details) as Record<string, unknown>) : undefined,
        threadResults: result.threadResults?.map((segment) => ({
          index: segment.index,
          success: segment.success,
          postId: segment.postId,
          postUrl: segment.postUrl,
          error: segment.error,
          message: segment.message,
          details: segment.details ? (sanitizeForJson(segment.details) as Record<string, unknown>) : undefined,
        })),
      }));

      return NextResponse.json({
        post: updatedPost,
        postingResults: sanitizedResults,
        summary,
      });
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
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/v1/posts/[id] - Delete a post
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    // Get the post to delete its media from R2
    const post = await repository.getPostById(id);
    if (!post) {
      throw new NotFoundError("Post not found");
    }

    await assertNoUnresolvedQuotes(session.user.id, id);

    const postMedia = [...post.media, ...(post.thread ?? []).flatMap((segment) => segment.media ?? [])];

    // Delete uploaded files from R2
    await Promise.all([
      deleteMediaFiles(session.user.id, postMedia),
      deleteAccountOptionFiles(session.user.id, post.accountOptions),
    ]);

    await repository.deletePost(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
