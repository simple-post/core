import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PrismaPostsRepository } from "@/lib/repositories/prisma";
import { deleteFromR2, getKeyFromUrl } from "@/lib/r2";

// PATCH /api/posts/[id] - Update a post
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PrismaPostsRepository(session.user.id);
    const updates = await req.json();
    const post = await repository.updatePost(params.id, updates);

    return NextResponse.json({ post });
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/posts/[id] - Delete a post
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PrismaPostsRepository(session.user.id);

    // Get the post to delete its media from R2
    const posts = await repository.getScheduledPosts();
    const pastPosts = await repository.getPastPosts();
    const allPosts = [...posts, ...pastPosts];
    const post = allPosts.find((p) => p.id === params.id);

    // Delete media files from R2
    if (post && post.media.length > 0) {
      await Promise.all(
        post.media.map(async (media) => {
          const key = getKeyFromUrl(media.url);
          if (key) {
            try {
              await deleteFromR2(key);
            } catch (error) {
              console.error(`Failed to delete media from R2: ${key}`, error);
            }
          }
        }),
      );
    }

    await repository.deletePost(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
