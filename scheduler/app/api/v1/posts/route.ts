import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { createLogger, serializeError } from "@/lib/logger";
import { requireAuth } from "@/lib/middleware/auth";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { handleApiError, BadRequestError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { createPostSchema } from "@/lib/validations/posts";
import type { MediaFile } from "@/types";

const log = createLogger("api:posts");

// GET /api/v1/posts - Get all posts (scheduled, past, and failed) with pagination
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
        const [scheduled, past, failed] = await Promise.all([
          repository.getScheduledPosts({ page: 1, limit: 1000 }),
          repository.getPastPosts({ page: 1, limit: 1000 }),
          repository.getFailedPosts({ page: 1, limit: 1000 }),
        ]);
        const posts = [...scheduled.data, ...past.data, ...failed.data];
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

    // Parse JSON body
    const body = await req.json();
    log.debug("Parsing JSON body");

    const {
      message,
      accountIds,
      postingMode,
      scheduledFor: scheduledForStr,
      accountOptions,
      accountOverrides,
      media,
    } = body;

    log.debug({ postingMode, messageLength: message?.length || 0 }, "Request body parsed");

    if (!accountIds) {
      log.warn("Validation failed: accountIds missing");
      throw new BadRequestError("accountIds are required");
    }

    log.debug({ accountCount: accountIds.length, accountIds }, "Parsed account IDs");

    if (accountOptions) {
      log.debug({ accountOptionsCount: Object.keys(accountOptions).length }, "Account options provided");
    }
    if (accountOverrides) {
      log.debug({ accountOverridesCount: Object.keys(accountOverrides).length }, "Account overrides provided");
    }

    // Validate with schema
    const validationData = {
      message,
      accountIds,
      postingMode: postingMode as "now" | "schedule",
      scheduledFor: scheduledForStr || undefined,
      accountOptions,
      accountOverrides,
    };

    log.debug("Validating data with schema");
    const validated = createPostSchema.parse(validationData);
    log.debug("Validation successful");

    // Get scheduledFor based on posting mode
    let scheduledFor: Date;
    if (validated.postingMode === "now") {
      scheduledFor = new Date(); // Post immediately
      log.debug("Posting immediately (now)");
    } else {
      if (!validated.scheduledFor) {
        log.warn("scheduledFor required but missing for schedule mode");
        throw new BadRequestError("scheduledFor is required when postingMode is 'schedule'");
      }
      scheduledFor = new Date(validated.scheduledFor);
      log.debug({ scheduledFor: scheduledFor.toISOString() }, "Scheduling for future");
    }

    // Media files are already uploaded to R2, just use the URLs
    const mediaFiles: MediaFile[] = media || [];
    log.debug({ mediaCount: mediaFiles.length }, "Media files from request");
    mediaFiles.forEach((mf: MediaFile, idx: number) => {
      log.debug({ index: idx + 1, type: mf.type, filename: mf.filename, size: mf.size }, "Media file");
    });

    const validation = await validatePostForAccounts({
      userId,
      message: validated.message,
      media: mediaFiles,
      accountIds: validated.accountIds,
      accountOverrides: validated.accountOverrides,
    });

    if (validation.accounts.length !== validated.accountIds.length) {
      throw new BadRequestError("One or more accounts were not found");
    }

    if (!validation.summary.isValid) {
      throw new ValidationError(validation);
    }

    // Create the post first
    log.debug("Creating post record in database");
    const post = await repository.createPost(
      {
        message: validated.message,
        accountIds: validated.accountIds,
        media: mediaFiles,
        scheduledFor,
        status: validated.postingMode === "now" ? "pending" : "scheduled",
        accountOptions: validated.accountOptions,
        accountOverrides: validated.accountOverrides,
      },
      userId,
    );
    log.info({ postId: post.id }, "Post created");

    // If posting now, actually post to the platforms
    if (validated.postingMode === "now") {
      log.info({ postId: post.id }, "Starting platform posting (immediate mode)");
      try {
        const results = await postToAccounts(
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
          validated.accountOverrides,
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

        // Update post status based on results
        if (summary.overallSuccess) {
          log.debug({ postId: post.id }, "Updating post status to published");
          await repository.updatePost(post.id, {
            status: "published",
            publishedAt: new Date(),
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
            })),
          }) as Record<string, unknown>;

          await repository.updatePost(post.id, {
            status: "failed",
            errorMessage,
            errorDetails,
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
    log.info({ postId: post.id, durationMs }, "Post scheduled successfully");
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error({ err: serializeError(error), durationMs }, "Request failed");
    return handleApiError(error);
  }
}
