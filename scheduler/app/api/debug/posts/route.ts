import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PrismaPostsRepository } from "@/lib/repositories/prisma";

// GET /api/debug/posts - Debug endpoint to check post data
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PrismaPostsRepository(session.user.id);
    const posts = await repository.getScheduledPosts();

    // Return detailed post information for debugging
    return NextResponse.json({
      count: posts.length,
      posts: posts.map((post) => ({
        id: post.id,
        message: post.message,
        hasMedia: post.media.length > 0,
        media: post.media.map((m) => ({
          id: m.id,
          type: m.type,
          filename: m.filename,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl,
          hasThumbnail: !!m.thumbnailUrl,
        })),
      })),
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
