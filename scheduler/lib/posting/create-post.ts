import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";
import { IMAGE_FIT_HELP } from "@simple-post/sdk";

import { measurementFailure, recordFunnelEvent } from "@/lib/analytics/events";
import { getTrialExpiryScheduleWarning } from "@/lib/billing/schedule-warning";
import {
  assertCanCreatePost,
  getBillingStatus,
  lockUserForQuota,
  toBillingSocialAccounts,
} from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { serverMessage } from "@/lib/i18n/server";
import { joinedValidationMessages } from "@/lib/i18n/validation-display";
import { createLogger, serializeError } from "@/lib/logger";
import { ingestPostMedia } from "@/lib/media-ingestion";
import { requireAuth } from "@/lib/middleware/auth";
import { getCredentialIssuesForPublishTime } from "@/lib/oauth/credential-health";
import { postToAccounts, getPostingSummary } from "@/lib/posting";
import type { PostingResultCallback } from "@/lib/posting";
import { toAccountResultsMap } from "@/lib/posting/account-results";
import { deferPostRetry } from "@/lib/posting/defer-post-retry";
import { sanitizePostingResult } from "@/lib/posting/progress-stream";
import { longestThreadLength } from "@/lib/posting/thread-length";
import { prisma } from "@/lib/prisma";
import { validateQuoteSource } from "@/lib/quote/source";
import { buildQuoteTargets } from "@/lib/quote/targets";
import { buildPublishedRepostState, resolvePostRepostSettings } from "@/lib/repost/settings";
import { handleApiError, BadRequestError, ApiError, ValidationError, sanitizeForJson } from "@/lib/utils/errors";
import { queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { requiredDraftImageFittingErrors } from "@/lib/validation/draft-image-fitting";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { createPostSchema } from "@/lib/validations/posts";
import { getScheduledForValueError, parseScheduledForValue } from "@/lib/validations/scheduled-time";
import { dispatchPostWebhooks } from "@/lib/webhooks";
import type { AccountResultsMap, MediaFile, ThreadSegmentResult } from "@/types";

const log = createLogger("api:posts");

type PostingMode = "now" | "schedule" | "draft";

async function getScheduleWarnings(userId: string, scheduledFor: Date | null) {
  if (!scheduledFor) return [];
  const warning = getTrialExpiryScheduleWarning(await getBillingStatus(userId), scheduledFor);
  return warning ? [warning] : [];
}

function resolveScheduledFor(postingMode: PostingMode, scheduledForValue?: string): Date | null {
  if (postingMode === "draft") {
    return null;
  }

  if (postingMode === "now") {
    return new Date();
  }

  if (!scheduledForValue) {
    throw new BadRequestError(
      serverMessage("Choose a date and time before scheduling this post."),
      "INVALID_SCHEDULED_TIME",
    );
  }

  const scheduledForError = getScheduledForValueError(scheduledForValue);
  if (scheduledForError) {
    throw new BadRequestError(serverMessage(scheduledForError), "INVALID_SCHEDULED_TIME");
  }

  return parseScheduledForValue(scheduledForValue)!;
}

export async function createPost(
  req: NextRequest,
  {
    readBody = (request) => request.json(),
    onPostingResult,
  }: {
    readBody?: (request: NextRequest) => Promise<unknown>;
    onPostingResult?: PostingResultCallback;
  } = {},
) {
  const startTime = Date.now();
  log.info("Received post creation request");

  let measurementUserId: string | null = null;
  try {
    log.debug("Authenticating user");
    const session = await requireAuth(req);
    const userId = session.user.id;
    measurementUserId = userId;
    await recordFunnelEvent(userId, "post_create_attempted", {
      channel:
        session.session?.token === "mcp"
          ? "mcp"
          : session.session?.token === "cli" || session.session?.token === "api_key"
            ? "api"
            : "web",
    });
    log.debug({ userId }, "User authenticated");

    const repository = new PostsModel(userId);

    const parsed = createPostSchema.parse(await readBody(req));
    log.debug({ postingMode: parsed.postingMode, messageLength: parsed.message.length }, "Request body parsed");
    let validated = { ...parsed, accountIds: [...new Set(parsed.accountIds)] };
    log.debug({ accountCount: validated.accountIds.length }, "Validation successful");

    // Idempotent creation: a retried request with the same key returns the
    // originally created post instead of creating (and publishing) again.
    if (validated.idempotencyKey) {
      const existing = await prisma.post.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
        select: { id: true },
      });
      if (existing) {
        const existingPost = await repository.getPostById(existing.id);
        log.info({ postId: existing.id }, "Idempotency key replay - returning existing post");
        return NextResponse.json(
          {
            post: existingPost,
            replayed: true,
            warnings: await getScheduleWarnings(userId, existingPost?.scheduledFor ?? null),
          },
          { status: 200 },
        );
      }
    }

    validated = await ingestPostMedia(userId, validated, {
      onUploaded: async (url) => {
        await prisma.$transaction((tx) => queueStorageDeletion(tx, userId, url));
      },
    });

    const postingMode = validated.postingMode;
    const scheduledFor = resolveScheduledFor(postingMode, validated.scheduledFor);
    const scheduleWarnings = await getScheduleWarnings(userId, postingMode === "schedule" ? scheduledFor : null);
    if (postingMode === "now") {
      log.debug("Posting immediately (now)");
    } else if (postingMode === "schedule") {
      log.debug({ scheduledFor: scheduledFor?.toISOString() }, "Scheduling for future");
    } else {
      log.debug("Saving post as draft");
    }

    const mediaFiles: MediaFile[] = validated.media || [];

    const quoteSource = await validateQuoteSource({
      userId,
      quotePostId: validated.quotePostId,
      postingMode,
      scheduledFor,
    });

    const validation = await validatePostForAccounts({
      checkAccountReadiness: postingMode !== "draft",
      imageFit: validated.imageFit,
      userId,
      message: validated.message,
      media: mediaFiles,
      accountIds: validated.accountIds,
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides,
      thread: validated.thread,
    });

    if (validation.accounts.length !== validated.accountIds.length) {
      throw new BadRequestError(serverMessage("One or more accounts were not found"));
    }

    const draftImageErrors = await requiredDraftImageFittingErrors({
      errors: validation.summary.errors,
      postingMode,
      userId,
    });
    if ((postingMode !== "draft" && !validation.summary.isValid) || draftImageErrors.length > 0) {
      throw new ValidationError(
        draftImageErrors.length > 0 ? { ...validation, imageFitHelp: IMAGE_FIT_HELP } : validation,
        draftImageErrors.length > 0
          ? serverMessage("The draft contains images that must be fitted before it can be saved. {{help}}", {
              help: serverMessage(IMAGE_FIT_HELP),
            })
          : undefined,
      );
    }

    if (postingMode !== "draft" && scheduledFor) {
      const credentialIssues = await getCredentialIssuesForPublishTime({
        accountIds: validated.accountIds,
        publishAt: scheduledFor,
        userId,
      });
      if (credentialIssues.length > 0) {
        throw new BadRequestError(joinedValidationMessages(credentialIssues, " "));
      }
    }

    const repostSettings = await resolvePostRepostSettings(userId, validated.repost);

    // Serialize the quota check and insert for this user. The in-transaction
    // idempotency check ensures a concurrent replay returns the winner even
    // when the first request consumed the final quota slot.
    log.debug("Creating post record in database");
    let post;
    try {
      const creation = await prisma.$transaction(async (tx) => {
        await lockUserForQuota(tx, userId);

        if (validated.idempotencyKey) {
          const existing = await tx.post.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
            select: { id: true },
          });
          if (existing) {
            return { replayedPostId: existing.id } as const;
          }
        }

        await assertCanCreatePost(userId, tx, {
          action: `create_${postingMode}_post`,
          socialAccounts: toBillingSocialAccounts(validation.accounts),
          threadSegments: longestThreadLength(validated.accountIds, validated.thread, validated.accountOverrides),
          isDraft: postingMode === "draft",
        });
        const createdPost = await repository.createPost(
          {
            message: validated.message,
            accountIds: validated.accountIds,
            media: mediaFiles,
            scheduledFor,
            status: postingMode === "now" ? "pending" : postingMode === "schedule" ? "scheduled" : "draft",
            accountOptions: validated.accountOptions,
            accountOverrides: validated.accountOverrides,
            repostEnabled: repostSettings.enabled,
            repostDelayHours: repostSettings.delayHours,
            repostStatus: "not_applicable",
            repostDueAt: null,
            thread: validated.thread,
            quotePostId: validated.quotePostId,
            idempotencyKey: validated.idempotencyKey,
          },
          userId,
          tx,
        );
        return { post: createdPost } as const;
      });

      if ("replayedPostId" in creation) {
        const replayedPostId = creation.replayedPostId!;
        const existingPost = await repository.getPostById(replayedPostId);
        log.info({ postId: replayedPostId }, "Idempotency key replay after quota lock");
        return NextResponse.json(
          {
            post: existingPost,
            replayed: true,
            warnings: scheduleWarnings,
          },
          { status: 200 },
        );
      }

      post = creation.post;
    } catch (createError) {
      // Concurrent request with the same idempotency key won the insert:
      // return the winner's post.
      if (
        validated.idempotencyKey &&
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        const existing = await prisma.post.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: validated.idempotencyKey } },
          select: { id: true },
        });
        const existingPost = existing ? await repository.getPostById(existing.id) : null;
        log.info({ postId: existing?.id }, "Idempotency key replay (concurrent) - returning existing post");
        return NextResponse.json(
          {
            post: existingPost,
            replayed: true,
            warnings: scheduleWarnings,
          },
          { status: 200 },
        );
      }
      throw createError;
    }
    log.info({ postId: post.id }, "Post created");

    // If posting now, actually post to the platforms
    if (postingMode === "now") {
      log.info({ postId: post.id }, "Starting platform posting (immediate mode)");
      try {
        const quoteTargets = quoteSource ? buildQuoteTargets(quoteSource, validation.accounts) : undefined;
        const results = await postToAccounts(
          userId,
          validated.message,
          mediaFiles,
          validated.accountIds,
          validated.accountOptions,
          validated.accountOverrides,
          validated.thread,
          quoteTargets,
          onPostingResult,
          { postId: post.id, source: "api" },
        );
        const summary = getPostingSummary(results);

        log.info(
          {
            successCount: summary.successCount,
            failureCount: summary.failureCount,
            overallSuccess: summary.overallSuccess,
          },
          "Posting results",
        );

        const threadResultsByAccount: Record<string, ThreadSegmentResult[]> = {};
        for (const r of results) {
          if (r.threadResults) threadResultsByAccount[r.accountId] = r.threadResults;
        }
        const hasThreadResults = Object.keys(threadResultsByAccount).length > 0;

        const accountResults = sanitizeForJson(toAccountResultsMap(results)) as AccountResultsMap;

        // Update post status based on results
        const deferred = await deferPostRetry(post.id, results, accountResults, threadResultsByAccount);
        if (deferred) {
          // Keep the original queued for a safe retry, preserving successful targets.
        } else if (summary.overallSuccess) {
          const publishedAt = new Date();
          const repostState = buildPublishedRepostState({
            enabled: repostSettings.enabled,
            delayHours: repostSettings.delayHours,
            accountResults,
            publishedAt,
          });
          log.debug({ postId: post.id }, "Updating post status to published");
          await repository.updatePost(post.id, {
            status: "published",
            publishedAt,
            threadResults: hasThreadResults ? threadResultsByAccount : undefined,
            accountResults,
            repostDueAt: repostState.repostDueAt,
            repostStatus: repostState.repostStatus,
            repostResults: null,
            repostErrorMessage: null,
            repostErrorDetails: null,
          });
          await dispatchPostWebhooks(userId, "post.published", {
            id: post.id,
            status: "published",
            message: validated.message,
            publishedAt: publishedAt.toISOString(),
            accountResults,
          });
        } else {
          log.debug({ postId: post.id }, "Updating post status to failed");
          // Collect error details from failed platforms
          const failedResults = results.filter((r) => !r.success);
          const errorMessage =
            failedResults.length === 1
              ? failedResults[0].message || failedResults[0].error || "Unknown error"
              : `Failed on ${failedResults.length} platform(s)`;
          const errorDetails = sanitizeForJson({
            failedPlatforms: failedResults.map((r) => ({
              accountId: r.accountId,
              platform: r.platform,
              error: r.error,
              message: r.message,
              details: r.details,
              threadResults: r.threadResults,
            })),
          }) as Record<string, unknown>;

          await repository.updatePost(post.id, {
            status: "failed",
            errorMessage,
            errorDetails,
            threadResults: hasThreadResults ? threadResultsByAccount : undefined,
            accountResults,
            repostDueAt: null,
            repostStatus: "not_applicable",
          });
          await dispatchPostWebhooks(userId, "post.failed", {
            id: post.id,
            status: "failed",
            message: validated.message,
            errorMessage,
            accountResults,
          });
        }

        const updatedPost = await repository.getPostById(post.id);
        const durationMs = Date.now() - startTime;
        log.info({ postId: post.id, durationMs }, "Request completed successfully");

        const sanitizedResults = results.map((result) => sanitizePostingResult(result));

        return NextResponse.json(
          {
            post: updatedPost,
            postingResults: sanitizedResults,
            summary,
          },
          { status: 201 },
        );
      } catch (postingError) {
        // Update post status to failed
        log.error({ err: serializeError(postingError), postId: post.id }, "Error during platform posting");
        const errorMessage = postingError instanceof Error ? postingError.message : "Unknown error during posting";
        const errorDetails = {
          error: postingError instanceof Error ? postingError.message : String(postingError),
          stack: postingError instanceof Error ? postingError.stack : undefined,
        };

        await repository.updatePost(post.id, {
          status: "failed",
          errorMessage,
          errorDetails,
          repostDueAt: null,
          repostStatus: "not_applicable",
        });

        const durationMs = Date.now() - startTime;
        log.error({ durationMs }, "Failed to post to platforms");
        throw new ApiError(serverMessage("Publishing could not be confirmed. Check Posts before retrying."), 500);
      }
    }

    const durationMs = Date.now() - startTime;
    log.info({ postId: post.id, durationMs, postingMode }, "Post created successfully");
    return NextResponse.json({ post, warnings: scheduleWarnings }, { status: 201 });
  } catch (error) {
    if (measurementUserId)
      await recordFunnelEvent(measurementUserId, "post_create_rejected", {
        properties: { reason: measurementFailure(error) },
      });
    return handleApiError(error, req);
  }
}
