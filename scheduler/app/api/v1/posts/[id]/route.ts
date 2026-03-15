import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, NotFoundError, BadRequestError, ValidationError } from "@/lib/utils/errors";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { updatePostSchema } from "@/lib/validations/posts";
import type { MediaFile } from "@/types";

// GET /api/v1/posts/[id] - Get a single post by ID
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    const repository = new PostsModel(session.user.id);

    const post = await repository.getPostById(id);
    if (!post) {
      throw new NotFoundError("Post not found");
    }

    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/v1/posts/[id] - Update a post
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

    // Parse and validate body
    const body = await req.json();
    const validated = updatePostSchema.parse(body);

    // Media is already uploaded to R2, just use the provided array
    const finalMedia: MediaFile[] = body.media || [];

    const validation = await validatePostForAccounts({
      userId: session.user.id,
      message: validated.message,
      media: finalMedia,
      accountIds: validated.accountIds,
      accountOverrides: validated.accountOverrides,
    });

    if (validation.accounts.length !== validated.accountIds.length) {
      throw new BadRequestError("One or more accounts were not found");
    }

    if (!validation.summary.isValid) {
      throw new ValidationError(validation);
    }

    // Capture old media URLs before update for R2 cleanup
    const oldMediaUrls = new Set(currentPost.media.map((m) => m.url));
    const newMediaUrls = new Set(finalMedia.map((m) => m.url));
    const removedMedia = currentPost.media.filter((m) => !newMediaUrls.has(m.url));

    // Update the post
    const post = await repository.updatePost(id, {
      message: validated.message,
      accountIds: validated.accountIds,
      scheduledFor: new Date(validated.scheduledFor),
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides,
      media: finalMedia,
    });

    // Clean up removed media from R2 (best-effort, don't fail the request)
    if (removedMedia.length > 0) {
      await deleteMediaFiles(removedMedia);
    }

    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/v1/posts/[id] - Delete a post
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
