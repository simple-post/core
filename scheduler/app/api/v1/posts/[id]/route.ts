import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { handleApiError, NotFoundError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { checkRateLimits } from "@/lib/utils/rate-limit";
import { checkAndDeductXCredits } from "@/lib/utils/x-credits";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { updatePostSchema } from "@/lib/validations/posts";
import type { MediaFile, PostingMode, SocialPost, ThreadSegmentResult } from "@/types";

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
      return currentScheduledFor;
    }
    throw new BadRequestError("scheduledFor is required when postingMode is 'schedule'");
  }

  const scheduledFor = new Date(scheduledForValue);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new BadRequestError("scheduledFor must be a valid ISO 8601 datetime");
  }
  if (scheduledFor <= new Date()) {
    throw new BadRequestError("scheduledFor must be in the future");
  }

  return scheduledFor;
}

function getAccountIdsNeedingWriteChecks(currentPost: SocialPost, nextMode: PostingMode, nextAccountIds: string[]) {
  if (nextMode === "draft") {
    return [];
  }

  if (currentPost.status !== "scheduled") {
    return nextAccountIds;
  }

  const currentAccountIds = new Set(currentPost.accountIds);
  return nextAccountIds.filter((accountId) => !currentAccountIds.has(accountId));
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

    const checkedAccountIds = getAccountIdsNeedingWriteChecks(currentPost, postingMode, validated.accountIds);
    if (checkedAccountIds.length > 0) {
      await checkRateLimits(session.user.id, checkedAccountIds);
      await checkAndDeductXCredits(session.user.id, checkedAccountIds);
    }

    // Capture removed media before update for R2 cleanup. Include media from
    // every thread segment in the comparison, otherwise removing a segment
    // would orphan its media in R2.
    const newMediaUrls = new Set([
      ...finalMedia.map((m) => m.url),
      ...(validated.thread ?? []).flatMap((s) => (s.media ?? []).map((m) => m.url)),
    ]);
    const oldThreadMedia = (currentPost.thread ?? []).flatMap((s) => s.media ?? []);
    const removedMedia = [...currentPost.media, ...oldThreadMedia].filter((m) => !newMediaUrls.has(m.url));

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
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides,
      media: finalMedia,
      thread: validated.thread,
    });

    // Clean up removed media from R2 (best-effort, don't fail the request)
    if (removedMedia.length > 0) {
      await deleteMediaFiles(removedMedia);
    }

    if (postingMode !== "now") {
      return NextResponse.json({ post });
    }

    try {
      const results = await postToAccounts(
        validated.message,
        finalMedia,
        validated.accountIds,
        validated.accountOptions,
        validated.accountOverrides,
        validated.thread,
      );
      const summary = getPostingSummary(results);

      const threadResultsByAccount: Record<string, ThreadSegmentResult[]> = {};
      for (const result of results) {
        if (result.threadResults) threadResultsByAccount[result.accountId] = result.threadResults;
      }
      const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;

      if (summary.overallSuccess) {
        await repository.updatePost(post.id, {
          status: "published",
          publishedAt: new Date(),
          threadResults: hasThreadResults ? threadResultsByAccount : undefined,
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

    // Delete media files from R2
    if (post.media.length > 0) {
      await deleteMediaFiles(post.media);
    }

    await repository.deletePost(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
