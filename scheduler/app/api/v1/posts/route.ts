import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { assertCanCreatePost, lockUserForQuota, toBillingSocialAccounts } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { createLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import type { PostingResultCallback } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import {
  createPostingProgressStream,
  sanitizePostingResult,
  wantsPostingProgress,
} from "@/lib/posting/progress-stream";
import { prisma } from "@/lib/prisma";
import { validateQuoteSource } from "@/lib/quote/source";
import { buildQuoteTargets } from "@/lib/quote/targets";
import { buildPublishedRepostState, resolvePostRepostSettings } from "@/lib/repost/settings";
import { handleApiError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { createPostSchema } from "@/lib/validations/posts";
import { getScheduledForValueError, parseScheduledForValue } from "@/lib/validations/scheduled-time";
import { dispatchPostWebhooks } from "@/lib/webhooks";
import type { AccountResultsMap, MediaFile, ThreadSegmentResult } from "@/types";

const log = createLogger("api:posts");

type PostingMode = "now" | "schedule" | "draft";

async function getPostCounts(userId: string) {
  const [drafts, scheduled, past, failed, failedLatest] = await Promise.all([
    prisma.post.count({ where: { userId, status: "draft" } }),
    prisma.post.count({ where: { userId, status: "scheduled" } }),
    prisma.post.count({ where: { userId, status: "published" } }),
    prisma.post.count({ where: { userId, status: "failed" } }),
    prisma.post.aggregate({
      _max: { updatedAt: true },
      where: { userId, status: "failed" },
    }),
  ]);

  return {
    counts: {
      drafts,
      failed,
      past,
      scheduled,
    },
    latestFailedAt: failedLatest._max.updatedAt?.toISOString() ?? null,
  };
}

function resolveScheduledFor(postingMode: PostingMode, scheduledForValue?: string): Date | null {
  if (postingMode === "draft") {
    return null;
  }

  if (postingMode === "now") {
    return new Date();
  }

  if (!scheduledForValue) {
    throw new BadRequestError("Choose a date and time before scheduling this post.");
  }

  const scheduledForError = getScheduledForValueError(scheduledForValue);
  if (scheduledForError) {
    throw new BadRequestError(scheduledForError);
  }

  return parseScheduledForValue(scheduledForValue)!;
}

// GET /api/v1/posts - Get all posts (drafts, scheduled, past, and failed) with pagination
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "25", 10)));

    const paginationOptions = { page, limit };

    switch (type) {
      case "counts": {
        return NextResponse.json(await getPostCounts(session.user.id), {
          headers: {
            "Cache-Control": "private, no-store",
          },
        });
      }
      case "scheduled": {
        const result = await repository.getScheduledPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "drafts": {
        const result = await repository.getDraftPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "past": {
        const result = await repository.getPastPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "failed": {
        const result = await repository.getFailedPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      default: {
        // For "all" type, we don't support pagination - return all posts
        const [drafts, scheduled, past, failed] = await Promise.all([
          repository.getDraftPosts({ page: 1, limit: 1000 }),
          repository.getScheduledPosts({ page: 1, limit: 1000 }),
          repository.getPastPosts({ page: 1, limit: 1000 }),
          repository.getFailedPosts({ page: 1, limit: 1000 }),
        ]);
        const posts = [...drafts.data, ...scheduled.data, ...past.data, ...failed.data];
        return NextResponse.json({ posts });
      }
    }
  } catch (error) {
    return handleApiError(error);
  }
}

async function createPost(req: NextRequest, onPostingResult?: PostingResultCallback) {
  const startTime = Date.now();
  log.info("Received post creation request");

  try {
    log.debug("Authenticating user");
    const session = await requireAuth(req);
    const userId = session.user.id;
    log.debug({ userId }, "User authenticated");

    const repository = new PostsModel(userId);

    const body = await req.json();
    log.debug({ postingMode: body.postingMode, messageLength: body.message?.length || 0 }, "Request body parsed");

    const parsed = createPostSchema.parse(body);
    const validated = { ...parsed, accountIds: [...new Set(parsed.accountIds)] };
    log.debug({ accountCount: validated.accountIds.length }, "Validation successful");

    // Idempotent creation: a retried request with the same key returns the
    // originally created post instead of creating (and publishing) again.
    if (validated.idempotencyKey) {
      const existing = await prisma.post.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
        select: { id: true },
      });
      if (existing) {
        const existingPost = await repository.getPostById(existing.id);
        log.info({ postId: existing.id }, "Idempotency key replay - returning existing post");
        return NextResponse.json({ post: existingPost, replayed: true }, { status: 200 });
      }
    }

    const postingMode = validated.postingMode;
    const scheduledFor = resolveScheduledFor(postingMode, validated.scheduledFor);
    if (postingMode === "now") {
      log.debug("Posting immediately (now)");
    } else if (postingMode === "schedule") {
      log.debug({ scheduledFor: scheduledFor?.toISOString() }, "Scheduling for future");
    } else {
      log.debug("Saving post as draft");
    }

    const mediaFiles: MediaFile[] = validated.media || [];

    const quoteSource = await validateQuoteSource({
      userId,
      quotePostId: validated.quotePostId,
      postingMode,
      scheduledFor,
    });

    const validation = await validatePostForAccounts({
      userId,
      message: validated.message,
      media: mediaFiles,
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
        userId,
      });
      if (credentialIssues.length > 0) {
        throw new BadRequestError(credentialIssues.map((issue) => issue.message).join(" "));
      }
    }

    const repostSettings = await resolvePostRepostSettings(userId, validated.repost);

    // Serialize the quota check and insert for this user. The in-transaction
    // idempotency check ensures a concurrent replay returns the winner even
    // when the first request consumed the final quota slot.
    log.debug("Creating post record in database");
    let post;
    try {
      const creation = await prisma.$transaction(async (tx) => {
        await lockUserForQuota(tx, userId);

        if (validated.idempotencyKey) {
          const existing = await tx.post.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
            select: { id: true },
          });
          if (existing) {
            return { replayedPostId: existing.id } as const;
          }
        }

        await assertCanCreatePost(userId, tx, {
          action: `create_${postingMode}_post`,
          socialAccounts: toBillingSocialAccounts(validation.accounts),
        });
        const createdPost = await repository.createPost(
          {
            message: validated.message,
            accountIds: validated.accountIds,
            media: mediaFiles,
            scheduledFor,
            status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
            accountOptions: validated.accountOptions,
            accountOverrides: validated.accountOverrides,
            repostEnabled: repostSettings.enabled,
            repostDelayHours: repostSettings.delayHours,
            repostStatus: "not_applicable",
            repostDueAt: null,
            thread: validated.thread,
            quotePostId: validated.quotePostId,
            idempotencyKey: validated.idempotencyKey,
          },
          userId,
          tx,
        );
        return { post: createdPost } as const;
      });

      if ("replayedPostId" in creation) {
        const replayedPostId = creation.replayedPostId!;
        const existingPost = await repository.getPostById(replayedPostId);
        log.info({ postId: replayedPostId }, "Idempotency key replay after quota lock");
        return NextResponse.json({ post: existingPost, replayed: true }, { status: 200 });
      }

      post = creation.post;
    } catch (createError) {
      // Concurrent request with the same idempotency key won the insert:
      // return the winner's post.
      if (
        validated.idempotencyKey &&
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        const existing = await prisma.post.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
          select: { id: true },
        });
        const existingPost = existing ? await repository.getPostById(existing.id) : null;
        log.info({ postId: existing?.id }, "Idempotency key replay (concurrent) - returning existing post");
        return NextResponse.json({ post: existingPost, replayed: true }, { status: 200 });
      }
      throw createError;
    }
    log.info({ postId: post.id }, "Post created");

    // If posting now, actually post to the platforms
    if (postingMode === "now") {
      log.info({ postId: post.id }, "Starting platform posting (immediate mode)");
      try {
        const quoteTargets = quoteSource ? buildQuoteTargets(quoteSource, validation.accounts) : undefined;
        const results = await postToAccounts(
          userId,
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
          validated.accountOverrides,
          validated.thread,
          quoteTargets,
          onPostingResult,
          { postId: post.id, source: "api" },
        );
        const summary = getPostingSummary(results);

        log.info(
          {
            successCount: summary.successCount,
            failureCount: summary.failureCount,
            overallSuccess: summary.overallSuccess,
          },
          "Posting results",
        );

        const threadResultsByAccount: Record<string, ThreadSegmentResult[]> = {};
        for (const r of results) {
          if (r.threadResults) threadResultsByAccount[r.accountId] = r.threadResults;
        }
        const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;

        const accountResults = sanitizeForJson(toAccountResultsMap(results)) as AccountResultsMap;

        // Update post status based on results
        if (summary.overallSuccess) {
          const publishedAt = new Date();
          const repostState = buildPublishedRepostState({
            enabled: repostSettings.enabled,
            delayHours: repostSettings.delayHours,
            accountResults,
            publishedAt,
          });
          log.debug({ postId: post.id }, "Updating post status to published");
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
          log.debug({ postId: post.id }, "Updating post status to failed");
          // Collect error details from failed platforms
          const failedResults = results.filter((r) => !r.success);
          const errorMessage =
            failedResults.length === 1
              ? failedResults[0].message || failedResults[0].error || "Unknown error"
              : `Failed on ${failedResults.length} platform(s)`;
          const errorDetails = sanitizeForJson({
            failedPlatforms: failedResults.map((r) => ({
              accountId: r.accountId,
              platform: r.platform,
              error: r.error,
              message: r.message,
              details: r.details,
              threadResults: r.threadResults,
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
        const durationMs = Date.now() - startTime;
        log.info({ postId: post.id, durationMs }, "Request completed successfully");

        const sanitizedResults = results.map((result) => sanitizePostingResult(result));

        return NextResponse.json(
          {
            post: updatedPost,
            postingResults: sanitizedResults,
            summary,
          },
          { status: 201 },
        );
      } catch (postingError) {
        // Update post status to failed
        log.error({ err: serializeError(postingError), postId: post.id }, "Error during platform posting");
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

        const durationMs = Date.now() - startTime;
        log.error({ durationMs }, "Failed to post to platforms");
        throw new BadRequestError("Failed to post to platforms");
      }
    }

    const durationMs = Date.now() - startTime;
    log.info({ postId: post.id, durationMs, postingMode }, "Post created successfully");
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error({ err: serializeError(error), durationMs }, "Request failed");
    return handleApiError(error);
  }
}

// POST /api/v1/posts - Create a new post
export async function POST(req: NextRequest) {
  if (wantsPostingProgress(req)) {
    return createPostingProgressStream((onResult) => createPost(req, onResult));
  }

  return createPost(req);
}
