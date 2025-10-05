import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PrismaPostsRepository } from "@/lib/repositories/prisma";
import { uploadToR2, generateFileKey } from "@/lib/r2";
import { generateThumbnail } from "@/lib/thumbnail";

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
    const scheduledFor = new Date(formData.get("scheduledFor") as string);
    const accountOptions = formData.get("accountOptions")
      ? JSON.parse(formData.get("accountOptions") as string)
      : undefined;

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

    const post = await repository.createPost(
      {
        message,
        accountIds,
        media: mediaFiles,
        scheduledFor,
        status: "scheduled",
        accountOptions,
      },
      session.user.id,
    );

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
