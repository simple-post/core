import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, NotFoundError, BadRequestError } from "@/lib/utils/errors";
import { PostsModel } from "@/lib/db";
import { deleteMediaFiles } from "@/lib/utils/media-cleanup";
import { processMediaFiles } from "@/lib/utils/media-upload";
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

    // Parse form data
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const accountIdsStr = formData.get("accountIds") as string;
    const scheduledForStr = formData.get("scheduledFor") as string;
    const accountOptionsStr = formData.get("accountOptions") as string | null;
    const keepMediaIdsStr = formData.get("keepMediaIds") as string | null;

    if (!message || !accountIdsStr || !scheduledForStr) {
      throw new BadRequestError("Message, accountIds, and scheduledFor are required");
    }

    let accountIds: string[];
    try {
      accountIds = JSON.parse(accountIdsStr);
    } catch {
      throw new BadRequestError("Invalid accountIds format");
    }

    const accountOptions = accountOptionsStr ? JSON.parse(accountOptionsStr) : undefined;
    const keepMediaIds = keepMediaIdsStr ? JSON.parse(keepMediaIdsStr) : [];

    // Validate with schema
    const validated = updatePostSchema.parse({
      message,
      accountIds,
      scheduledFor: scheduledForStr,
      accountOptions,
      keepMediaIds,
    });

    // Handle media updates
    const keepMediaIdsSet = new Set(validated.keepMediaIds || []);
    const mediaToDelete = currentPost.media.filter((m) => !keepMediaIdsSet.has(m.id));

    // Delete removed media files from R2
    if (mediaToDelete.length > 0) {
      await deleteMediaFiles(mediaToDelete);
    }

    // Keep existing media that should be kept
    const finalMedia: MediaFile[] = currentPost.media.filter((m) => keepMediaIdsSet.has(m.id));

    // Upload new media files
    const newFiles = formData.getAll("media").filter((f): f is File => f instanceof File);
    if (newFiles.length > 0) {
      const newMediaFiles = await processMediaFiles(newFiles, session.user.id);
      finalMedia.push(...newMediaFiles);
    }

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
