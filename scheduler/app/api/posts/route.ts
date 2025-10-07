import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PrismaPostsRepository } from "@/lib/repositories/prisma";
import { uploadToR2, generateFileKey } from "@/lib/r2";
import { generateThumbnail } from "@/lib/thumbnail";
import { postToAccounts, getPostingSummary } from "@/lib/posting-service";

// GET /api/posts - Get all posts (scheduled and past)
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PrismaPostsRepository(session.user.id);
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
    console.error("Error fetching posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/posts - Create a new post
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PrismaPostsRepository(session.user.id);
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const accountIds = JSON.parse(formData.get("accountIds") as string);
    const postingMode = (formData.get("postingMode") as string) || "schedule";
    const accountOptions = formData.get("accountOptions")
      ? JSON.parse(formData.get("accountOptions") as string)
      : undefined;

    // Get scheduledFor based on posting mode
    let scheduledFor: Date;
    if (postingMode === "now") {
      scheduledFor = new Date(); // Post immediately
    } else {
      scheduledFor = new Date(formData.get("scheduledFor") as string);
    }

    // Handle media uploads
    const mediaFiles = [];
    const files = formData.getAll("media");

    for (const file of files) {
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const key = generateFileKey(session.user.id, file.name);
        const url = await uploadToR2(buffer, key, file.type);

        // Generate and upload thumbnail
        let thumbnailUrl: string | undefined;
        const thumbnail = await generateThumbnail(buffer, file.name, file.type);
        if (thumbnail) {
          const thumbnailKey = generateFileKey(session.user.id, thumbnail.filename);
          thumbnailUrl = await uploadToR2(thumbnail.buffer, thumbnailKey, "image/jpeg");
        }

        const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
        mediaFiles.push({
          id: crypto.randomUUID(),
          url,
          thumbnailUrl,
          type: mediaType,
          filename: file.name,
          size: file.size,
        });
      }
    }

    // Create the post first
    const post = await repository.createPost(
      {
        message,
        accountIds,
        media: mediaFiles,
        scheduledFor,
        status: postingMode === "now" ? "published" : "scheduled",
        accountOptions,
      },
      session.user.id,
    );

    // If posting now, actually post to the platforms
    if (postingMode === "now") {
      try {
        const results = await postToAccounts(message, mediaFiles, accountIds, accountOptions);
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

        return NextResponse.json(
          {
            post: await repository.getPastPosts().then((posts) => posts.find((p) => p.id === post.id)),
            postingResults: results,
            summary,
          },
          { status: 201 },
        );
      } catch (postingError) {
        console.error("Error posting to platforms:", postingError);
        // Update post status to failed
        await repository.updatePost(post.id, {
          status: "failed",
        });

        return NextResponse.json(
          {
            error: "Failed to post to platforms",
            post: await repository.getPastPosts().then((posts) => posts.find((p) => p.id === post.id)),
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
