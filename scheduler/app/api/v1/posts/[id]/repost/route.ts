import { type NextRequest, NextResponse } from "next/server";

import * as z from "zod";

import { assertActiveSubscription, toBillingSocialAccounts } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { repostToAccounts } from "@/lib/posting";
import { prisma } from "@/lib/prisma";
import { summarizeRepostOutcome } from "@/lib/repost/results";
import { buildRepostTargets } from "@/lib/repost/targets";
import { handleApiError, BadRequestError, ConflictError, NotFoundError, sanitizeForJson } from "@/lib/utils/errors";
import type { AccountOptionsMap } from "@/types";

const manualRepostSchema = z.object({
  accountIds: z.array(z.string()).min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(req, { action: "manual_repost", postId: id });
    const repository = new PostsModel(session.user.id);
    const body = await req.json().catch(() => ({}));
    const validated = manualRepostSchema.parse(body);

    const post = await prisma.post.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        accounts: {
          select: {
            id: true,
            platform: true,
            platformAccountId: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundError("Post not found");
    }
    if (post.status !== "published") {
      throw new BadRequestError("Only published posts can be reposted");
    }

    const requestedAccountIds = validated.accountIds ? new Set(validated.accountIds) : null;
    const accounts = requestedAccountIds
      ? post.accounts.filter((account) => requestedAccountIds.has(account.id))
      : post.accounts;

    if (requestedAccountIds && accounts.length !== requestedAccountIds.size) {
      throw new BadRequestError("One or more accounts do not belong to this post");
    }

    const targets = buildRepostTargets({
      accountResults: post.accountResults,
      accounts,
    });

    if (targets.length === 0) {
      throw new BadRequestError("This post has no successful publish results on repost-capable accounts");
    }

    await assertActiveSubscription(session.user.id, {
      action: "manual_repost",
      postId: post.id,
      socialAccounts: toBillingSocialAccounts(accounts),
    });

    // Atomically claim the repost before firing it. Any state except an
    // in-flight "pending" can be (re)claimed; a 0-row result means a concurrent
    // auto-repost dispatch or a double-submit already holds it. This mirrors the
    // dispatcher's claimReposts and prevents the same post being reposted twice.
    const { count: claimed } = await prisma.post.updateMany({
      where: { id, userId: session.user.id, repostStatus: { not: "pending" } },
      data: { repostStatus: "pending" },
    });
    if (claimed === 0) {
      throw new ConflictError("A repost for this post is already in progress");
    }

    let results: Awaited<ReturnType<typeof repostToAccounts>>;
    try {
      results = await repostToAccounts(
        session.user.id,
        targets,
        (post.accountOptions as AccountOptionsMap | null) ?? undefined,
      );
    } catch (repostError) {
      // Never leave the post stuck in "pending" if the repost call itself
      // throws — record the failure so the user sees an actionable state.
      const message = repostError instanceof Error ? repostError.message : "Unknown error while reposting";
      await repository.updatePost(id, {
        repostStatus: "failed",
        repostDueAt: null,
        repostErrorMessage: message,
        repostErrorDetails: sanitizeForJson({
          error: message,
          stack: repostError instanceof Error ? repostError.stack : undefined,
        }) as Record<string, unknown>,
      });
      throw repostError;
    }

    const outcome = summarizeRepostOutcome(results);

    await repository.updatePost(
      id,
      outcome.summary.overallSuccess
        ? {
            repostStatus: "completed",
            repostDueAt: null,
            repostedAt: new Date(),
            repostResults: outcome.repostResults,
            repostErrorMessage: null,
            repostErrorDetails: null,
          }
        : {
            repostStatus: "failed",
            repostDueAt: null,
            repostResults: outcome.repostResults,
            repostErrorMessage: outcome.errorMessage,
            repostErrorDetails: outcome.errorDetails,
          },
    );

    const updatedPost = await repository.getPostById(id);
    const sanitizedResults = results.map((result) => ({
      accountId: result.accountId,
      platform: result.platform,
      success: result.success,
      error: result.error,
      message: result.message,
      postId: result.postId,
      postUrl: result.postUrl,
      details: result.details ? (sanitizeForJson(result.details) as Record<string, unknown>) : undefined,
      platformData: result.platformData,
    }));

    return NextResponse.json({
      post: updatedPost,
      repostingResults: sanitizedResults,
      summary: outcome.summary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
