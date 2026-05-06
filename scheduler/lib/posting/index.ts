import {
  buildReplyOverlay,
  extractChainStep,
  isThreadCapable,
  PostErrorType,
  post as sdkPost,
  prepareMedia,
} from "@simple-post/sdk";

import { postingLogger, serializeError, redact } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";
import { sanitizeForJson } from "@/lib/utils/errors";
import { mapPlatformName } from "@/lib/utils/platforms";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import { buildPostOptions } from "./credentials";
import { refreshTikTokTokenIfNeeded } from "./tiktok-refresh";

import type { Post, Platform, Media, ThreadChainState, ThreadSegment, ThreadSegmentResult } from "@simple-post/sdk";
import type { Logger } from "pino";

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
  threadResults?: ThreadSegmentResult[];
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}

/**
 * Generates a post URL for a platform based on the post ID
 */
function generatePostUrl(platform: string, postId: string, account?: ConnectedAccount): string | undefined {
  postingLogger.debug({ platform, postId }, "Generating URL for platform");

  const platformLower = platform.toLowerCase();

  switch (platformLower) {
    case "youtube": {
      return `https://www.youtube.com/watch?v=${postId}`;
    }
    case "x":
    case "twitter": {
      // X/Twitter post URLs require username, but we can construct a basic URL
      const username = account?.username || account?.platformAccountId || "";
      return username ? `https://x.com/${username.replace("@", "")}/status/${postId}` : undefined;
    }
    case "facebook": {
      // Facebook post URLs typically need page ID and post ID
      const pageId = account?.platformAccountId || "";
      return pageId ? `https://www.facebook.com/${pageId}/posts/${postId}` : undefined;
    }
    case "instagram": {
      // Instagram public URLs require an opaque shortcode (e.g. `DX44yisCEr5`).
      // The Graph API returns a numeric media id which is NOT usable in the
      // /p/ URL — `instagram.com/p/{numericId}/` returns a 404. The publisher
      // populates `result.url` with the proper permalink; if we end up here
      // with a numeric id it means the permalink fetch failed and there's no
      // working URL we can construct.
      if (/^\d+$/.test(postId)) {
        postingLogger.warn(
          { platform, postId },
          "Instagram permalink unavailable; cannot construct a public URL from numeric media id",
        );
        return undefined;
      }
      return `https://www.instagram.com/p/${postId}/`;
    }
    case "tiktok": {
      // TikTok's Direct Post API returns a `publish_id` like
      // `v_pub_file~v2-1.7635755340554061846` immediately; the real numeric
      // video id (e.g. `7635755895103786273`) is only available after the
      // publish-status poll completes. The publisher returns the public id
      // when it can, but for unaudited apps the post is routed to the
      // creator's inbox and no public id ever exists. We can never
      // synthesize the video id from the publish_id (the numeric portion
      // does not match), so fall back to the creator's profile URL when we
      // only have a publish_id — the user can still navigate to their post
      // from there.
      const username = account?.username?.replace("@", "");
      if (!/^\d+$/.test(postId)) {
        postingLogger.warn(
          { platform, postId },
          "TikTok public video id unavailable (got publish_id); falling back to creator profile URL",
        );
        return username ? `https://www.tiktok.com/@${username}` : undefined;
      }
      return username ? `https://www.tiktok.com/@${username}/video/${postId}` : undefined;
    }
    case "telegram": {
      // Telegram doesn't have public URLs for posts, but we can link to the channel
      const chatId = account?.platformAccountId || "";
      if (chatId.startsWith("@")) {
        return `https://t.me/${chatId.replace("@", "")}/${postId}`;
      }
      return undefined;
    }
    case "bluesky": {
      if (postId.startsWith("at://")) {
        const parts = postId.split("/");
        const recordKey = parts.at(-1);
        if (!recordKey) return undefined;
        const handleOrDid = account?.username || account?.platformAccountId || "";
        return handleOrDid ? `https://bsky.app/profile/${handleOrDid.replace("@", "")}/post/${recordKey}` : undefined;
      }
      return undefined;
    }
    case "threads": {
      const username = account?.username || "";
      return username ? `https://www.threads.net/@${username.replace("@", "")}/post/${postId}` : undefined;
    }
    case "linkedin": {
      // The LinkedIn `/ugcPosts` API returns URNs like
      // `urn:li:ugcPost:7456790957989093376` (or `urn:li:share:...`).
      // LinkedIn's `/feed/update/` URL accepts these URNs as-is and
      // redirects to the actual post page — note that ugcPost and activity
      // URNs have DIFFERENT numeric IDs for the same post, so we cannot
      // synthesize an activity URN by swapping the prefix; we have to pass
      // through whatever the API gave us. Colons must stay raw —
      // percent-encoding them breaks LinkedIn's redirect.
      return `https://www.linkedin.com/feed/update/${postId}`;
    }
    case "pinterest": {
      return `https://www.pinterest.com/pin/${postId}/`;
    }
    default: {
      postingLogger.warn({ platform }, "Unknown platform for URL generation");
      return undefined;
    }
  }
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
  const platformLower = account.platform.toLowerCase();
  if (
    platformLower !== "x" &&
    platformLower !== "instagram" &&
    platformLower !== "bluesky" &&
    platformLower !== "threads"
  )
    return;

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
    log.debug({ postData: sanitizedPostData, hasReplyOverlay: !!replyOverlay }, "SDK post() call data");

    const results = await sdkPost(postData);
    const result = results.get(platform);

    if (result?.extraData?.refreshedCredentials) {
      applyRefreshedCredentialsToAccount(account, result.extraData.refreshedCredentials);
      await persistRefreshedCredentials(account, result.extraData.refreshedCredentials, log);
    }

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      // Prefer the canonical URL returned by the publisher (Instagram and
      // Threads provide a permalink that we can't construct from the id
      // alone). Fall back to building the URL from the post id otherwise.
      const postUrl = result.url ?? generatePostUrl(platform, result.id, account);
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

/**
 * Posts content to a single account using the SDK with pre-prepared media
 */
async function postToAccountWithPreparedMedia(
  message: string,
  preparedMedia: Media[],
  account: ConnectedAccount,
  accountOptions?: AccountOptionsMap,
): Promise<PostingResult> {
  const log = postingLogger.child({
    fn: "postToAccountWithPreparedMedia",
    accountId: account.id,
    platform: account.platform,
  });

  log.info({ messageLength: message.length, mediaCount: preparedMedia.length }, "Starting post to platform");
  return postSingleSegment(message, preparedMedia, account, accountOptions, undefined, log);
}

interface AccountSegment {
  message: string;
  mediaFiles: MediaFile[];
}

async function postSegmentsToAccount(
  segments: AccountSegment[],
  account: ConnectedAccount,
  accountOptions?: AccountOptionsMap,
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

  for (const [i, segment] of effectiveSegments.entries()) {
    const media: Media[] = mapMediaFilesToSdk(segment.mediaFiles);
    const tempPost: Post = {
      content: { text: segment.message, media: media.length > 0 ? media : undefined },
      platforms: [platform],
    };

    const { post: preparedPost, cleanup } = await prepareMedia(tempPost);
    let segmentResult: PostingResult;
    try {
      const overlay = buildReplyOverlay(platform, chain);
      const segmentLog = log.child({ segmentIndex: i });
      segmentResult = await postSingleSegment(
        segment.message,
        preparedPost.content.media || [],
        account,
        accountOptions,
        overlay,
        segmentLog,
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
    } finally {
      await cleanup();
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
        }
      : {
          type: "video",
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
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
 * Posts content to multiple accounts
 */
export async function postToAccounts(
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  accountOverrides?: AccountOverridesMap,
  thread?: ThreadSegment[],
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

    // Refresh TikTok tokens if expired (access tokens expire after 24 hours)
    const refreshedAccounts = await Promise.all(accounts.map((account) => refreshTikTokTokenIfNeeded(account)));

    const hasOverrides = !!accountOverrides && Object.keys(accountOverrides).length > 0;
    const sharedThread = thread ?? [];
    const hasThread =
      sharedThread.length > 0 || Object.values(accountOverrides ?? {}).some((o) => (o.thread ?? []).length > 0);

    if (hasThread) {
      log.debug("Posting via thread loop");
      const results = await Promise.all(
        refreshedAccounts.map((account) => {
          const segments = buildAccountSegments(account.id, message, mediaFiles, sharedThread, accountOverrides);
          return postSegmentsToAccount(segments, account, accountOptions);
        }),
      );

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;
      log.info({ successCount, failureCount, durationMs: Date.now() - startTime }, "Thread posting complete");
      return results;
    }

    if (!hasOverrides) {
      // Convert media files to SDK format (simple mapping - SDK will handle resolution)
      log.debug("Converting media files to SDK format");
      const media: Media[] = mapMediaFilesToSdk(mediaFiles);
      log.debug({ mediaItemCount: media.length }, "Media conversion complete");

      // Get all unique platforms for efficient media resolution
      const uniquePlatforms = [
        ...new Set(refreshedAccounts.map((account) => mapPlatformName(account.platform))),
      ] as Platform[];

      log.debug({ uniquePlatforms }, "Unique platforms identified");

      // Prepare media once for all platforms (downloads/uploads as needed)
      log.debug("Preparing media for all platforms");
      const tempPost: Post = {
        content: {
          text: message,
          media: media.length > 0 ? media : undefined,
        },
        platforms: uniquePlatforms,
        options: undefined, // Options are per-account, not needed for media resolution
      };

      const { post: preparedPost, cleanup } = await prepareMedia(tempPost);
      log.debug("Media preparation complete");

      try {
        // Post to all accounts in parallel using prepared media
        log.debug("Posting to all accounts in parallel");
        const preparedMedia = preparedPost.content.media || [];
        const results = await Promise.all(
          refreshedAccounts.map((account) =>
            postToAccountWithPreparedMedia(message, preparedMedia, account, accountOptions),
          ),
        );

        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.filter((r) => !r.success).length;
        const durationMs = Date.now() - startTime;

        log.info({ successCount, failureCount, durationMs }, "Posting complete");

        // Log detailed results
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
      } finally {
        // Cleanup temporary files and S3 uploads
        log.debug("Cleaning up temporary media files");
        await cleanup();
      }
    }

    log.debug("Posting with account-specific overrides");

    const results = await Promise.all(
      refreshedAccounts.map(async (account) => {
        const override = accountOverrides?.[account.id];
        const accountMessage = override?.message ?? message;
        const accountMediaFiles = override?.media ?? mediaFiles;
        const media = mapMediaFilesToSdk(accountMediaFiles);
        const platform = mapPlatformName(account.platform);

        const tempPost: Post = {
          content: {
            text: accountMessage,
            media: media.length > 0 ? media : undefined,
          },
          platforms: [platform],
          options: undefined,
        };

        const { post: preparedPost, cleanup } = await prepareMedia(tempPost);

        try {
          const preparedMedia = preparedPost.content.media || [];
          return await postToAccountWithPreparedMedia(accountMessage, preparedMedia, account, accountOptions);
        } finally {
          await cleanup();
        }
      }),
    );

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    const durationMs = Date.now() - startTime;

    log.info({ successCount, failureCount, durationMs }, "Posting complete");

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
