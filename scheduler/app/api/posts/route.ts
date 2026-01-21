import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { PostsModel } from "@/lib/db";
import { processMediaFiles } from "@/lib/utils/media-upload";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { createPostSchema } from "@/lib/validations/posts";
import { BadRequestError } from "@/lib/utils/errors";

// GET /api/posts - Get all posts (scheduled, past, and failed)
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";

    let posts;
    if (type === "scheduled") {
      posts = await repository.getScheduledPosts();
    } else if (type === "past") {
      posts = await repository.getPastPosts();
    } else if (type === "failed") {
      posts = await repository.getFailedPosts();
    } else {
      const [scheduled, past, failed] = await Promise.all([
        repository.getScheduledPosts(),
        repository.getPastPosts(),
        repository.getFailedPosts(),
      ]);
      posts = [...scheduled, ...past, ...failed];
    }

    return NextResponse.json({ posts });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log(`[POST /api/posts] Received post creation request`);

  try {
    console.log(`[POST /api/posts] Authenticating user`);
    const session = await requireAuth(req);
    console.log(`[POST /api/posts] User authenticated: ${session.user.id}`);

    const repository = new PostsModel(session.user.id);
    const formData = await req.formData();

    // Parse and validate form data
    console.log(`[POST /api/posts] Parsing form data`);
    const message = formData.get("message") as string;
    const accountIdsStr = formData.get("accountIds") as string;
    const postingMode = (formData.get("postingMode") as string) || "schedule";
    const accountOptionsStr = formData.get("accountOptions") as string | null;

    console.log(`[POST /api/posts] Posting mode: ${postingMode}`);
    console.log(`[POST /api/posts] Message length: ${message?.length || 0} characters`);

    if (!message || !accountIdsStr) {
      console.error(`[POST /api/posts] Validation failed: Message or accountIds missing`);
      throw new BadRequestError("Message and accountIds are required");
    }

    let accountIds: string[];
    try {
      accountIds = JSON.parse(accountIdsStr);
      console.log(`[POST /api/posts] Parsed ${accountIds.length} account ID(s): ${accountIds.join(", ")}`);
    } catch {
      console.error(`[POST /api/posts] Failed to parse accountIds JSON`);
      throw new BadRequestError("Invalid accountIds format");
    }

    const accountOptions = accountOptionsStr ? JSON.parse(accountOptionsStr) : undefined;
    if (accountOptions) {
      console.log(`[POST /api/posts] Account options provided for ${Object.keys(accountOptions).length} account(s)`);
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

    console.log(`[POST /api/posts] Validating data with schema`);
    const validated = createPostSchema.parse(validationData);
    console.log(`[POST /api/posts] Validation successful`);

    // Get scheduledFor based on posting mode
    let scheduledFor: Date;
    if (validated.postingMode === "now") {
      scheduledFor = new Date(); // Post immediately
      console.log(`[POST /api/posts] Posting immediately (now)`);
    } else {
      if (!validated.scheduledFor) {
        console.error(`[POST /api/posts] scheduledFor required but missing for schedule mode`);
        throw new BadRequestError("scheduledFor is required when postingMode is 'schedule'");
      }
      scheduledFor = new Date(validated.scheduledFor);
      console.log(`[POST /api/posts] Scheduling for: ${scheduledFor.toISOString()}`);
    }

    // Handle media uploads
    console.log(`[POST /api/posts] Processing media files`);
    const files = formData.getAll("media").filter((f): f is File => f instanceof File);
    console.log(`[POST /api/posts] Found ${files.length} media file(s)`);

    const mediaFiles = await processMediaFiles(files, session.user.id);
    console.log(`[POST /api/posts] Processed ${mediaFiles.length} media file(s)`);
    mediaFiles.forEach((mf, idx) => {
      console.log(`[POST /api/posts] Media ${idx + 1}: ${mf.type} - ${mf.filename} (${mf.size} bytes)`);
    });

    // Create the post first
    console.log(`[POST /api/posts] Creating post record in database`);
    const post = await repository.createPost(
      {
        message: validated.message,
        accountIds: validated.accountIds,
        media: mediaFiles,
        scheduledFor,
        status: validated.postingMode === "now" ? "published" : "scheduled",
        accountOptions: validated.accountOptions,
      },
      session.user.id,
    );
    console.log(`[POST /api/posts] Post created with ID: ${post.id}`);

    // If posting now, actually post to the platforms
    if (validated.postingMode === "now") {
      console.log(`[POST /api/posts] Posting mode is "now", starting platform posting`);
      try {
        const results = await postToAccounts(
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
        );
        const summary = getPostingSummary(results);

        console.log(
          `[POST /api/posts] Posting results: ${summary.successCount} success, ${summary.failureCount} failed`,
        );
        console.log(`[POST /api/posts] Overall success: ${summary.overallSuccess}`);

        // Update post status based on results
        if (summary.overallSuccess) {
          console.log(`[POST /api/posts] Updating post status to "published"`);
          await repository.updatePost(post.id, {
            status: "published",
            publishedAt: new Date(),
          });
        } else {
          console.log(`[POST /api/posts] Updating post status to "failed"`);
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
        console.log(`[POST /api/posts] Request completed successfully in ${Date.now() - startTime}ms`);

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
        console.error(`[POST /api/posts] Error during platform posting:`, postingError);
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

        // Log the error but return a user-friendly message
        console.error(`[POST /api/posts] Failed to post to platforms after ${Date.now() - startTime}ms:`, postingError);
        throw new BadRequestError("Failed to post to platforms");
      }
    }

    console.log(`[POST /api/posts] Post scheduled successfully. Request completed in ${Date.now() - startTime}ms`);
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error(`[POST /api/posts] Request failed after ${Date.now() - startTime}ms:`, error);
    return handleApiError(error);
  }
}
