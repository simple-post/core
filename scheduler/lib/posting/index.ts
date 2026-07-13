import {
  buildReplyOverlay,
  extractChainStep,
  isRepostCapablePlatform,
  isThreadCapable,
  MediaResolver,
  PostErrorType,
  post as sdkPost,
  quote as sdkQuote,
  repost as sdkRepost,
} from "@simple-post/sdk";
import { generatePostUrl, mapPlatformName } from "@simple-post/sdk/platform-names";

import { postingLogger, serializeError, redact } from "@/lib/logger";
import { POST_CREDENTIAL_MIN_VALIDITY_MS, refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";
import { sanitizeForJson } from "@/lib/utils/errors";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import { reloadAccountSecrets, withAccountLock } from "./account-lock";
import { buildPostOptions } from "./credentials";

import type {
  Post,
  Media,
  QuoteTarget,
  RepostTarget,
  ThreadChainState,
  ThreadSegment,
  ThreadSegmentResult,
} from "@simple-post/sdk";
import type { Logger } from "pino";

export interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
  threadResults?: ThreadSegmentResult[];
  platformData?: Record<string, unknown>;
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}

export type PostingResultCallback = (result: PostingResult) => void;

export interface AccountRepostTarget extends RepostTarget {
  accountId: string;
  postUrl?: string;
}

export interface AccountQuoteTarget extends QuoteTarget {
  accountId: string;
  postUrl?: string;
}

function applyYouTubeDefaults(media: Media[], message: string, platform: string): Media[] {
  return media.map((m) => {
    if (m.type === "video" && platform === "youtube" && !m.title) {
      return {
        ...m,
        title: message.trim() || "Untitled Video",
        description: message.trim() || undefined,
      };
    }
    return m;
  });
}

function mergeReplyOverlay(
  options: ReturnType<typeof buildPostOptions>,
  overlay: ReturnType<typeof buildReplyOverlay>,
) {
  if (!overlay) return options;
  const existing = (options as Record<string, Record<string, unknown> | undefined>)[overlay.platform] ?? {};
  return {
    ...options,
    [overlay.platform]: { ...existing, ...overlay.options },
  };
}

async function persistRefreshedCredentials(
  account: ConnectedAccount,
  refreshedCredentials: NonNullable<NonNullable<PostingResult["extraData"]>["refreshedCredentials"]>,
  log: Logger,
) {
  try {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        ...encryptConnectedAccountSecrets({
          accessToken: refreshedCredentials.accessToken || account.accessToken,
          refreshToken: refreshedCredentials.refreshToken ?? account.refreshToken,
        }),
        expiresAt: refreshedCredentials.expiresAt ? new Date(refreshedCredentials.expiresAt * 1000) : account.expiresAt,
      },
    });
    log.info({ accountId: account.id, platform: account.platform }, "Updated credentials from refresh");
  } catch (updateError) {
    log.warn({ err: serializeError(updateError), accountId: account.id }, "Failed to update credentials");
  }
}

function applyRefreshedCredentialsToAccount(
  account: ConnectedAccount,
  refreshedCredentials: NonNullable<NonNullable<PostingResult["extraData"]>["refreshedCredentials"]>,
) {
  if (refreshedCredentials.accessToken) {
    account.accessToken = refreshedCredentials.accessToken;
  }
  if (refreshedCredentials.refreshToken !== undefined) {
    account.refreshToken = refreshedCredentials.refreshToken;
  }
  if (refreshedCredentials.expiresAt) {
    account.expiresAt = new Date(refreshedCredentials.expiresAt * 1000);
  }
}

/**
 * Posts a single segment (root or thread reply) to one platform. Handles
 * credential refresh persistence and logging.
 */
async function postSingleSegment(
  message: string,
  preparedMedia: Media[],
  account: ConnectedAccount,
  accountOptions: AccountOptionsMap | undefined,
  replyOverlay: ReturnType<typeof buildReplyOverlay>,
  log: Logger,
  quoteTarget?: AccountQuoteTarget,
): Promise<PostingResult> {
  const startTime = Date.now();
  try {
    const platform = mapPlatformName(account.platform);
    const baseOptions = buildPostOptions(account, accountOptions);
    const options = mergeReplyOverlay(baseOptions, replyOverlay);
    const processedMedia = applyYouTubeDefaults(preparedMedia, message, platform);

    const postData: Post = {
      content: {
        text: message,
        media: processedMedia.length > 0 ? processedMedia : undefined,
      },
      platforms: [platform],
      options,
    };

    const sanitizedPostData = {
      content: {
        text: postData.content.text,
        media: postData.content.media?.map((m) =>
          m.type === "video"
            ? { type: m.type, url: m.url, title: m.title, description: m.description, thumbnailUrl: m.thumbnailUrl }
            : { type: m.type, url: m.url, caption: m.caption },
        ),
      },
      platforms: postData.platforms,
      options: options ? redact(options as Record<string, unknown>) : undefined,
    };
    log.debug(
      { postData: sanitizedPostData, hasReplyOverlay: !!replyOverlay, hasQuoteTarget: !!quoteTarget },
      quoteTarget ? "SDK quote() call data" : "SDK post() call data",
    );

    const results = quoteTarget ? await sdkQuote({ ...postData, target: quoteTarget }) : await sdkPost(postData);
    const result = results.get(platform);

    if (result?.extraData?.refreshedCredentials) {
      applyRefreshedCredentialsToAccount(account, result.extraData.refreshedCredentials);
      await persistRefreshedCredentials(account, result.extraData.refreshedCredentials, log);
    }

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      // Prefer the canonical URL returned by the publisher (Instagram and
      // Threads provide a permalink that we can't construct from the id
      // alone). Fall back to building the URL from the post id otherwise.
      const postUrl =
        result.url ??
        generatePostUrl(platform, result.id, {
          username: account.username ?? undefined,
          platformAccountId: account.platformAccountId ?? undefined,
        });
      const durationMs = Date.now() - startTime;
      log.info(
        {
          postId: result.id,
          postUrl: postUrl || null,
          durationMs,
          credentialsRefreshed: !!result.extraData?.refreshedCredentials,
        },
        "Segment post successful",
      );
      return {
        accountId: account.id,
        platform: account.platform,
        success: true,
        postUrl,
        postId: result.id,
        message: result.message,
        details: result.details,
        platformData: result.extraData?.platformData,
        extraData: result.extraData,
      };
    }

    const errorMsg = result?.error || "Unknown error occurred";
    const errorMessage = result?.message || errorMsg;
    const durationMs = Date.now() - startTime;
    log.error(
      {
        error: errorMsg,
        errorMessage: result?.message,
        details: result?.details ? sanitizeForJson(result.details) : undefined,
        durationMs,
      },
      "Segment post failed",
    );
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: errorMsg,
      message: errorMessage,
      details: result?.details,
      platformData: result?.extraData?.platformData,
      extraData: result?.extraData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    const durationMs = Date.now() - startTime;
    log.error({ err: serializeError(error), durationMs }, "Exception while posting segment");
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: errorMessage,
    };
  }
}

interface AccountSegment {
  message: string;
  mediaFiles: MediaFile[];
}

async function postSegmentsToAccount(
  segments: AccountSegment[],
  account: ConnectedAccount,
  resolver: MediaResolver,
  accountOptions?: AccountOptionsMap,
  quoteTarget?: AccountQuoteTarget,
): Promise<PostingResult> {
  const log = postingLogger.child({
    fn: "postSegmentsToAccount",
    accountId: account.id,
    platform: account.platform,
    segmentCount: segments.length,
  });

  const platform = mapPlatformName(account.platform);
  const threadAware = isThreadCapable(platform);
  const effectiveSegments = threadAware ? segments : segments.slice(0, 1);

  if (!threadAware && segments.length > 1) {
    log.warn({ requestedSegments: segments.length }, "Platform does not support threads — only root will be posted");
  }

  const chain: ThreadChainState = {};
  const segmentResults: ThreadSegmentResult[] = [];
  let rootResult: PostingResult | undefined;

  // Hold the account lock for the whole thread so segments of concurrent
  // posts to the same account don't interleave and token refreshes (some
  // providers rotate refresh tokens) stay serialized. Credentials are
  // reloaded inside the lock to pick up tokens persisted by a publish this
  // one waited on.
  let credentialFailure: PostingResult | undefined;
  await withAccountLock(account.id, async () => {
    let freshAccount = await reloadAccountSecrets(account);
    const refreshResult = await refreshConnectedAccountIfNeeded(freshAccount, {
      minValidityMs: POST_CREDENTIAL_MIN_VALIDITY_MS,
      reason: "post",
    });
    if (refreshResult.error) {
      credentialFailure = {
        accountId: account.id,
        error: "CREDENTIALS_ERROR",
        message: refreshResult.error,
        platform: account.platform,
        success: false,
      };
      return;
    }
    freshAccount = refreshResult.account;

    for (const [i, segment] of effectiveSegments.entries()) {
      const media: Media[] = mapMediaFilesToSdk(segment.mediaFiles);
      // The resolver is shared across every account and segment of this
      // postToAccounts call: downloads/uploads are cached by source, so the
      // same media is fetched once no matter how many accounts post it.
      const preparedMedia = media.length > 0 ? await resolver.resolve(media, [platform]) : [];

      const overlay = buildReplyOverlay(platform, chain);
      const segmentLog = log.child({ segmentIndex: i });
      const segmentResult = await postSingleSegment(
        segment.message,
        preparedMedia,
        freshAccount,
        accountOptions,
        overlay,
        segmentLog,
        i === 0 ? quoteTarget : undefined,
      );

      if (segmentResult.success) {
        const step = extractChainStep(platform, {
          id: segmentResult.postId,
          error: PostErrorType.NO_ERROR,
          extraData: segmentResult.extraData,
        });
        if (step) {
          if (step.postId) chain.parentPostId = step.postId;
          if (step.bskyRef) {
            chain.parentBskyRef = step.bskyRef;
            if (i === 0) chain.rootBskyRef = step.bskyRef;
          }
        }
      }

      segmentResults.push({
        index: i,
        success: segmentResult.success,
        postId: segmentResult.postId,
        postUrl: segmentResult.postUrl,
        error: segmentResult.error,
        message: segmentResult.message,
        details: segmentResult.details,
      });

      if (i === 0) rootResult = segmentResult;
      if (!segmentResult.success) break;

      // Give the platform time to index the post before we reply to it.
      // Threads in particular needs ~2 seconds before a reply_to_id lookup succeeds.
      if (i < effectiveSegments.length - 1 && segmentResult.success) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  });

  if (credentialFailure) {
    return credentialFailure;
  }

  // Fill in skipped segments so the UI can show the correct X/Y total
  for (let i = segmentResults.length; i < effectiveSegments.length; i++) {
    segmentResults.push({ index: i, success: false, error: "Skipped due to earlier failure" });
  }

  const overallSuccess = segmentResults.every((s) => s.success);
  const base = rootResult ?? {
    accountId: account.id,
    platform: account.platform,
    success: false,
    error: "No segments to post",
  };

  if (effectiveSegments.length > 1) {
    return { ...base, success: overallSuccess, threadResults: segmentResults };
  }
  return base;
}

function mapMediaFilesToSdk(mediaFiles: MediaFile[]): Media[] {
  return mediaFiles.map((file) => {
    return file.type === "image"
      ? {
          type: "image",
          url: file.url,
          size: file.size,
        }
      : {
          type: "video",
          url: file.url,
          size: file.size,
          thumbnailUrl: file.thumbnailUrl,
          durationSec: file.durationSec,
        };
  });
}

function buildAccountSegments(
  accountId: string,
  rootMessage: string,
  rootMediaFiles: MediaFile[],
  sharedThread: ThreadSegment[],
  accountOverrides?: AccountOverridesMap,
): AccountSegment[] {
  const override = accountOverrides?.[accountId];
  const message = override?.message ?? rootMessage;
  const mediaFiles = override?.media ?? rootMediaFiles;
  const thread = override?.thread ?? sharedThread;

  return [
    { message, mediaFiles },
    ...thread.map((segment) => ({
      message: segment.message ?? "",
      mediaFiles: segment.media ?? [],
    })),
  ];
}

/**
 * Posts content to multiple accounts. Accounts are always resolved scoped to
 * `userId` — callers validate ownership at their API boundary, but the
 * constraint is enforced here too so no future call site can post to another
 * user's connected accounts.
 */
export async function postToAccounts(
  userId: string,
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  accountOverrides?: AccountOverridesMap,
  thread?: ThreadSegment[],
  quoteTargets?: AccountQuoteTarget[],
  onResult?: PostingResultCallback,
): Promise<PostingResult[]> {
  const startTime = Date.now();
  const log = postingLogger.child({ fn: "postToAccounts" });

  log.info(
    {
      accountCount: accountIds.length,
      accountIds,
      mediaFileCount: mediaFiles.length,
      threadSegmentCount: thread?.length ?? 0,
    },
    "Starting post to accounts",
  );

  try {
    // Fetch all connected accounts
    log.debug("Fetching connected accounts from database");
    const storedAccounts = await prisma.connectedAccount.findMany({
      where: {
        id: {
          in: accountIds,
        },
        userId,
      },
    });

    const accounts = storedAccounts.map((account) => decryptConnectedAccountSecrets(account));

    log.debug({ foundCount: accounts.length }, "Found accounts in database");

    if (accounts.length === 0) {
      log.error({ accountIds }, "No accounts found for the provided IDs");
      throw new Error("No accounts found");
    }

    // Log account details
    accounts.forEach((account) => {
      log.debug(
        { platform: account.platform, accountId: account.id, username: account.username || account.platformAccountId },
        "Account found",
      );
    });

    const sharedThread = thread ?? [];
    const quoteTargetByAccountId = new Map((quoteTargets ?? []).map((target) => [target.accountId, target]));

    // Every post is a list of segments per account (a plain post is a thread
    // of length 1; overrides swap in per-account message/media/thread). One
    // MediaResolver is shared across the whole call so identical media is
    // downloaded/uploaded once regardless of account count.
    const resolver = new MediaResolver();

    let results: PostingResult[];
    try {
      results = await Promise.all(
        accounts.map(async (account) => {
          const segments = buildAccountSegments(account.id, message, mediaFiles, sharedThread, accountOverrides);
          const result = await postSegmentsToAccount(
            segments,
            account,
            resolver,
            accountOptions,
            quoteTargetByAccountId.get(account.id),
          );

          // Progress reporting is best-effort. A disconnected streaming client
          // must never turn a successful platform publish into a failed one.
          try {
            onResult?.(result);
          } catch (progressError) {
            log.warn(
              { err: serializeError(progressError), accountId: result.accountId },
              "Failed to report platform posting progress",
            );
          }

          return result;
        }),
      );
    } finally {
      log.debug("Cleaning up temporary media files");
      await resolver.cleanup();
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    log.info({ successCount, failureCount, durationMs: Date.now() - startTime }, "Posting complete");

    results.forEach((result) => {
      if (result.success) {
        log.info(
          {
            platform: result.platform,
            postId: result.postId,
            postUrl: result.postUrl || null,
            credentialsRefreshed: !!result.extraData?.refreshedCredentials,
          },
          "Platform post succeeded",
        );
      } else {
        log.error(
          {
            platform: result.platform,
            error: result.error,
            message: result.message,
            details: result.details,
          },
          "Platform post failed",
        );
      }
    });

    return results;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error({ err: serializeError(error), durationMs }, "Fatal error in postToAccounts");
    throw error;
  }
}

async function repostSingleTarget(
  account: ConnectedAccount,
  target: AccountRepostTarget,
  accountOptions: AccountOptionsMap | undefined,
  log: Logger,
): Promise<PostingResult> {
  const platform = mapPlatformName(account.platform);
  if (!isRepostCapablePlatform(platform)) {
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: PostErrorType.INVALID_CONTENT,
      message: `${account.platform} does not support reposting through SimplePost.`,
    };
  }

  return withAccountLock(account.id, async () => {
    let freshAccount = await reloadAccountSecrets(account);
    const refreshResult = await refreshConnectedAccountIfNeeded(freshAccount, {
      minValidityMs: POST_CREDENTIAL_MIN_VALIDITY_MS,
      reason: "post",
    });
    if (refreshResult.error) {
      return {
        accountId: account.id,
        error: "CREDENTIALS_ERROR",
        message: refreshResult.error,
        platform: account.platform,
        success: false,
      };
    }
    freshAccount = refreshResult.account;
    const options = buildPostOptions(freshAccount, accountOptions);

    const results = await sdkRepost({
      target,
      platforms: [platform],
      options,
    });
    const result = results.get(platform);

    if (result?.extraData?.refreshedCredentials) {
      applyRefreshedCredentialsToAccount(freshAccount, result.extraData.refreshedCredentials);
      await persistRefreshedCredentials(freshAccount, result.extraData.refreshedCredentials, log);
    }

    if (result?.error === PostErrorType.NO_ERROR) {
      const repostId = result.id ?? target.postId;
      const postUrl =
        result.url ??
        target.postUrl ??
        (repostId
          ? generatePostUrl(platform, repostId, {
              username: freshAccount.username ?? undefined,
              platformAccountId: freshAccount.platformAccountId ?? undefined,
            })
          : undefined);

      return {
        accountId: account.id,
        platform: account.platform,
        success: true,
        postId: repostId,
        postUrl,
        message: result.message,
        details: result.details,
        platformData: result.extraData?.platformData,
        extraData: result.extraData,
      };
    }

    const errorMsg = result?.error || "Unknown error occurred";
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: errorMsg,
      message: result?.message ?? errorMsg,
      details: result?.details,
      platformData: result?.extraData?.platformData,
      extraData: result?.extraData,
    };
  });
}

export async function repostToAccounts(
  userId: string,
  targets: AccountRepostTarget[],
  accountOptions?: AccountOptionsMap,
): Promise<PostingResult[]> {
  const log = postingLogger.child({ fn: "repostToAccounts" });
  const targetByAccountId = new Map(targets.map((target) => [target.accountId, target]));
  const accountIds = [...targetByAccountId.keys()];

  const storedAccounts = await prisma.connectedAccount.findMany({
    where: {
      id: { in: accountIds },
      userId,
    },
  });

  const accounts = storedAccounts.map((account) => decryptConnectedAccountSecrets(account));
  const foundIds = new Set(accounts.map((account) => account.id));
  const missingResults: PostingResult[] = accountIds
    .filter((accountId) => !foundIds.has(accountId))
    .map((accountId) => ({
      accountId,
      platform: "unknown",
      success: false,
      error: "ACCOUNT_NOT_FOUND",
      message: "Account was not found or no longer belongs to this user.",
    }));

  const results = await Promise.all(
    accounts.map((account) => {
      const target = targetByAccountId.get(account.id);
      if (!target) {
        return Promise.resolve({
          accountId: account.id,
          platform: account.platform,
          success: false,
          error: PostErrorType.INVALID_CONTENT,
          message: "No repost target was provided for this account.",
        });
      }

      const accountLog = log.child({ accountId: account.id, platform: account.platform });
      return repostSingleTarget(account, target, accountOptions, accountLog);
    }),
  );

  return [...missingResults, ...results];
}

/**
 * Gets a summary of posting results
 */
export function getPostingSummary(results: PostingResult[]): {
  successCount: number;
  failureCount: number;
  overallSuccess: boolean;
} {
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return {
    successCount,
    failureCount,
    overallSuccess: successCount > 0 && failureCount === 0,
  };
}
