import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireReadAuth } from "@/lib/middleware/auth";
import { createPost } from "@/lib/posting/create-post";
import { createPostingProgressStream, wantsPostingProgress } from "@/lib/posting/progress-stream";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";

async function getPostCounts(userId: string) {
  const [drafts, scheduled, past, failed, failedLatest] = await Promise.all([
    prisma.post.count({ where: { userId, workspaceReviewId: null, status: "draft" } }),
    prisma.post.count({ where: { userId, workspaceReviewId: null, status: "scheduled" } }),
    prisma.post.count({ where: { userId, workspaceReviewId: null, status: "published" } }),
    prisma.post.count({ where: { userId, workspaceReviewId: null, status: "failed" } }),
    prisma.post.aggregate({
      _max: { updatedAt: true },
      where: { userId, workspaceReviewId: null, status: "failed" },
    }),
  ]);

  return {
    counts: {
      drafts,
      failed,
      past,
      scheduled,
    },
    latestFailedAt: failedLatest._max.updatedAt?.toISOString() ?? null,
  };
}

// GET /api/v1/posts - Get all posts (drafts, scheduled, past, and failed) with pagination
export async function GET(req: NextRequest) {
  try {
    const session = await requireReadAuth(req);
    const repository = new PostsModel(session.user.id);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "25", 10)));

    const paginationOptions = { page, limit };

    switch (type) {
      case "counts": {
        return NextResponse.json(await getPostCounts(session.user.id), {
          headers: {
            "Cache-Control": "private, no-store",
          },
        });
      }
      case "scheduled": {
        const result = await repository.getScheduledPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "drafts": {
        const result = await repository.getDraftPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "past": {
        const result = await repository.getPastPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      case "failed": {
        const result = await repository.getFailedPosts(paginationOptions);
        return NextResponse.json({ posts: result.data, pagination: result.pagination });
      }
      default: {
        // For "all" type, we don't support pagination - return all posts
        const [drafts, scheduled, past, failed] = await Promise.all([
          repository.getDraftPosts({ page: 1, limit: 1000 }),
          repository.getScheduledPosts({ page: 1, limit: 1000 }),
          repository.getPastPosts({ page: 1, limit: 1000 }),
          repository.getFailedPosts({ page: 1, limit: 1000 }),
        ]);
        const posts = [...drafts.data, ...scheduled.data, ...past.data, ...failed.data];
        return NextResponse.json({ posts });
      }
    }
  } catch (error) {
    return handleApiError(error, req);
  }
}

// POST /api/v1/posts - Create a new post
export async function POST(req: NextRequest) {
  if (wantsPostingProgress(req)) {
    return createPostingProgressStream((onResult) => createPost(req, { onPostingResult: onResult }));
  }

  return createPost(req);
}
