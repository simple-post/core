import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { PostsModel } from "@/lib/db";
import { processMediaFiles } from "@/lib/utils/media-upload";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import { createPostSchema } from "@/lib/validations/posts";
import { BadRequestError } from "@/lib/utils/errors";

// GET /api/posts - Get all posts (scheduled and past)
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
    } else {
      const [scheduled, past] = await Promise.all([repository.getScheduledPosts(), repository.getPastPosts()]);
      posts = [...scheduled, ...past];
    }

    return NextResponse.json({ posts });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);
    const formData = await req.formData();

    // Parse and validate form data
    const message = formData.get("message") as string;
    const accountIdsStr = formData.get("accountIds") as string;
    const postingMode = (formData.get("postingMode") as string) || "schedule";
    const accountOptionsStr = formData.get("accountOptions") as string | null;

    if (!message || !accountIdsStr) {
      throw new BadRequestError("Message and accountIds are required");
    }

    let accountIds: string[];
    try {
      accountIds = JSON.parse(accountIdsStr);
    } catch {
      throw new BadRequestError("Invalid accountIds format");
    }

    const accountOptions = accountOptionsStr ? JSON.parse(accountOptionsStr) : undefined;

    // Validate with schema
    const scheduledForStr = formData.get("scheduledFor") as string | null;
    const validationData = {
      message,
      accountIds,
      postingMode: postingMode as "now" | "schedule",
      scheduledFor: scheduledForStr || undefined,
      accountOptions,
    };

    const validated = createPostSchema.parse(validationData);

    // Get scheduledFor based on posting mode
    let scheduledFor: Date;
    if (validated.postingMode === "now") {
      scheduledFor = new Date(); // Post immediately
    } else {
      if (!validated.scheduledFor) {
        throw new BadRequestError("scheduledFor is required when postingMode is 'schedule'");
      }
      scheduledFor = new Date(validated.scheduledFor);
    }

    // Handle media uploads
    const files = formData.getAll("media").filter((f): f is File => f instanceof File);
    const mediaFiles = await processMediaFiles(files, session.user.id);

    // Create the post first
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

    // If posting now, actually post to the platforms
    if (validated.postingMode === "now") {
      try {
        const results = await postToAccounts(
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
        );
        const summary = getPostingSummary(results);

        // Update post status based on results
        if (summary.overallSuccess) {
          await repository.updatePost(post.id, {
            status: "published",
            publishedAt: new Date(),
          });
        } else {
          await repository.updatePost(post.id, {
            status: "failed",
          });
        }

        const updatedPost = await repository.getPostById(post.id);
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
        await repository.updatePost(post.id, {
          status: "failed",
        });

        const updatedPost = await repository.getPostById(post.id);
        // Log the error but return a user-friendly message
        console.error("Failed to post to platforms:", postingError);
        throw new BadRequestError("Failed to post to platforms");
      }
    }

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
