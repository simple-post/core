import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { PostsModel } from "@/lib/db";
import { processMediaFiles } from "@/lib/utils/media-upload";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { createPostSchema } from "@/lib/validations/posts";
import { BadRequestError } from "@/lib/utils/errors";
import { createLogger, serializeError } from "@/lib/logger";

const log = createLogger("api:posts");

// GET /api/posts - Get all posts (scheduled, past, and failed) with pagination
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const paginationOptions = { page, limit };

    if (type === "scheduled") {
      const result = await repository.getScheduledPosts(paginationOptions);
      return NextResponse.json({ posts: result.data, pagination: result.pagination });
    } else if (type === "past") {
      const result = await repository.getPastPosts(paginationOptions);
      return NextResponse.json({ posts: result.data, pagination: result.pagination });
    } else if (type === "failed") {
      const result = await repository.getFailedPosts(paginationOptions);
      return NextResponse.json({ posts: result.data, pagination: result.pagination });
    } else {
      // For "all" type, we don't support pagination - return all posts
      const [scheduled, past, failed] = await Promise.all([
        repository.getScheduledPosts({ page: 1, limit: 1000 }),
        repository.getPastPosts({ page: 1, limit: 1000 }),
        repository.getFailedPosts({ page: 1, limit: 1000 }),
      ]);
      const posts = [...scheduled.data, ...past.data, ...failed.data];
      return NextResponse.json({ posts });
    }
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  log.info("Received post creation request");

  try {
    log.debug("Authenticating user");
    const session = await requireAuth(req);
    const userId = session.user.id;
    log.debug({ userId }, "User authenticated");

    const repository = new PostsModel(userId);
    const formData = await req.formData();

    // Parse and validate form data
    log.debug("Parsing form data");
    const message = formData.get("message") as string;
    const accountIdsStr = formData.get("accountIds") as string;
    const postingMode = (formData.get("postingMode") as string) || "schedule";
    const accountOptionsStr = formData.get("accountOptions") as string | null;

    log.debug({ postingMode, messageLength: message?.length || 0 }, "Form data parsed");

    if (!message || !accountIdsStr) {
      log.warn("Validation failed: Message or accountIds missing");
      throw new BadRequestError("Message and accountIds are required");
    }

    let accountIds: string[];
    try {
      accountIds = JSON.parse(accountIdsStr);
      log.debug({ accountCount: accountIds.length, accountIds }, "Parsed account IDs");
    } catch {
      log.warn("Failed to parse accountIds JSON");
      throw new BadRequestError("Invalid accountIds format");
    }

    const accountOptions = accountOptionsStr ? JSON.parse(accountOptionsStr) : undefined;
    if (accountOptions) {
      log.debug({ accountOptionsCount: Object.keys(accountOptions).length }, "Account options provided");
    }

    // Validate with schema
    const scheduledForStr = formData.get("scheduledFor") as string | null;
    const validationData = {
      message,
      accountIds,
      postingMode: postingMode as "now" | "schedule",
      scheduledFor: scheduledForStr || undefined,
      accountOptions,
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

    // Handle media uploads
    log.debug("Processing media files");
    const files = formData.getAll("media").filter((f): f is File => f instanceof File);
    log.debug({ fileCount: files.length }, "Found media files");

    const mediaFiles = await processMediaFiles(files, userId);
    log.debug({ processedCount: mediaFiles.length }, "Processed media files");
    mediaFiles.forEach((mf, idx) => {
      log.debug({ index: idx + 1, type: mf.type, filename: mf.filename, size: mf.size }, "Media file processed");
    });

    // Create the post first
    log.debug("Creating post record in database");
    const post = await repository.createPost(
      {
        message: validated.message,
        accountIds: validated.accountIds,
        media: mediaFiles,
        scheduledFor,
        status: validated.postingMode === "now" ? "published" : "scheduled",
        accountOptions: validated.accountOptions,
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
        );
        const summary = getPostingSummary(results);

        log.info(
          { successCount: summary.successCount, failureCount: summary.failureCount, overallSuccess: summary.overallSuccess },
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
              ? failedResults[0].error || failedResults[0].message || "Unknown error"
              : `Failed on ${failedResults.length} platform(s)`;
          const errorDetails = {
            failedPlatforms: failedResults.map((r) => ({
              accountId: r.accountId,
              platform: r.platform,
              error: r.error,
              message: r.message,
              details: r.details,
            })),
          };

          await repository.updatePost(post.id, {
            status: "failed",
            errorMessage,
            errorDetails,
          });
        }

        const updatedPost = await repository.getPostById(post.id);
        const durationMs = Date.now() - startTime;
        log.info({ postId: post.id, durationMs }, "Request completed successfully");

        return NextResponse.json(
          {
            post: updatedPost,
            postingResults: results,
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
