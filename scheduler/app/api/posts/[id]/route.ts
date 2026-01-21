import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, NotFoundError, BadRequestError } from "@/lib/utils/errors";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { updatePostSchema } from "@/lib/validations/posts";
import type { MediaFile } from "@/types";

// PATCH /api/posts/[id] - Update a post
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    // Get the current post
    const currentPost = await repository.getPostById(id);
    if (!currentPost) {
      throw new NotFoundError("Post not found");
    }

    // Parse JSON body
    const body = await req.json();
    const { message, accountIds, scheduledFor: scheduledForStr, accountOptions, media } = body;

    if (!message || !accountIds || !scheduledForStr) {
      throw new BadRequestError("Message, accountIds, and scheduledFor are required");
    }

    // Validate with schema
    const validated = updatePostSchema.parse({
      message,
      accountIds,
      scheduledFor: scheduledForStr,
      accountOptions,
    });

    // Media is already uploaded to R2, just use the provided array
    const finalMedia: MediaFile[] = media || [];

    // Update the post
    const post = await repository.updatePost(id, {
      message: validated.message,
      accountIds: validated.accountIds,
      scheduledFor: new Date(validated.scheduledFor),
      accountOptions: validated.accountOptions,
      media: finalMedia,
    });

    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/posts/[id] - Delete a post
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    // Get the post to delete its media from R2
    const post = await repository.getPostById(id);
    if (!post) {
      throw new NotFoundError("Post not found");
    }

    // Delete media files from R2
    if (post.media.length > 0) {
      await deleteMediaFiles(post.media);
    }

    await repository.deletePost(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
