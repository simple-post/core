import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { createLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { handleApiError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { checkRateLimits } from "@/lib/utils/rate-limit";
import { checkAndDeductXCredits } from "@/lib/utils/x-credits";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { createPostSchema } from "@/lib/validations/posts";
import type { AccountResultsMap, MediaFile, ThreadSegmentResult } from "@/types";

const log = createLogger("api:posts");

type PostingMode = "now" | "schedule" | "draft";

function resolveScheduledFor(postingMode: PostingMode, scheduledForValue?: string): Date | null {
  if (postingMode === "draft") {
    return null;
  }

  if (postingMode === "now") {
    return new Date();
  }

  if (!scheduledForValue) {
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

// POST /api/v1/posts - Create a new post
export async function POST(req: NextRequest) {
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

    const validated = createPostSchema.parse(body);
    log.debug({ accountCount: validated.accountIds.length }, "Validation successful");

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

    if (postingMode !== "draft") {
      await checkRateLimits(userId, validated.accountIds);
      await checkAndDeductXCredits(userId, validated.accountIds);
    }

    // Create the post first
    log.debug("Creating post record in database");
    const post = await repository.createPost(
      {
        message: validated.message,
        accountIds: validated.accountIds,
        media: mediaFiles,
        scheduledFor,
        status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
        accountOptions: validated.accountOptions,
        accountOverrides: validated.accountOverrides,
        thread: validated.thread,
      },
      userId,
    );
    log.info({ postId: post.id }, "Post created");

    // If posting now, actually post to the platforms
    if (postingMode === "now") {
      log.info({ postId: post.id }, "Starting platform posting (immediate mode)");
      try {
        const results = await postToAccounts(
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
          validated.accountOverrides,
          validated.thread,
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
          log.debug({ postId: post.id }, "Updating post status to published");
          await repository.updatePost(post.id, {
            status: "published",
            publishedAt: new Date(),
            threadResults: hasThreadResults ? threadResultsByAccount : undefined,
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
          });
        }

        const updatedPost = await repository.getPostById(post.id);
        const durationMs = Date.now() - startTime;
        log.info({ postId: post.id, durationMs }, "Request completed successfully");

        const sanitizedResults = results.map((r) => ({
          accountId: r.accountId,
          platform: r.platform,
          success: r.success,
          error: r.error,
          message: r.message,
          postId: r.postId,
          postUrl: r.postUrl,
          details: r.details ? (sanitizeForJson(r.details) as Record<string, unknown>) : undefined,
          threadResults: r.threadResults?.map((s) => ({
            index: s.index,
            success: s.success,
            postId: s.postId,
            postUrl: s.postUrl,
            error: s.error,
            message: s.message,
            details: s.details ? (sanitizeForJson(s.details) as Record<string, unknown>) : undefined,
          })),
        }));

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
