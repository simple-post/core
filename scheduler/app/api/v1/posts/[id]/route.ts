import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import type { PostingResultCallback } from "@/lib/posting";
import { createPostingProgressStream, wantsPostingProgress } from "@/lib/posting/progress-stream";
import { executePostUpdate } from "@/lib/posting/update-post";
import { assertNoUnresolvedQuotes } from "@/lib/quote/source";
import { handleApiError, NotFoundError } from "@/lib/utils/errors";
import { deleteAccountOptionFiles, deleteMediaFiles } from "@/lib/utils/media-cleanup";

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
    return handleApiError(error, req);
  }
}

async function updatePost(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  onPostingResult?: PostingResultCallback,
) {
  try {
    const { id } = await params;
    const session = await requireAuth(req);
    return NextResponse.json(await executePostUpdate(session.user.id, id, await req.json(), onPostingResult));
  } catch (error) {
    return handleApiError(error, req);
  }
}

// PATCH /api/v1/posts/[id] - Update a post
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (wantsPostingProgress(req)) {
    return createPostingProgressStream((onResult) => updatePost(req, context, onResult));
  }

  return updatePost(req, context);
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

    await assertNoUnresolvedQuotes(session.user.id, id);

    const postMedia = [...post.media, ...(post.thread ?? []).flatMap((segment) => segment.media ?? [])];

    // Claim deletion before touching storage; an active publisher or a newer
    // edit must retain its media when this request loses the race.
    await repository.deletePost(id, post.updatedAt);

    // Delete uploaded files from R2
    await Promise.all([
      deleteMediaFiles(session.user.id, postMedia),
      deleteAccountOptionFiles(session.user.id, post.accountOptions),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
