import { PostErrorType, post as sdkPost, prepareMedia } from "@simple-post/sdk";

import { postingLogger, serializeError, redact } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";
import { sanitizeForJson } from "@/lib/utils/errors";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import { buildPostOptions } from "./credentials";
import { refreshTikTokTokenIfNeeded } from "./tiktok-refresh";

import type { Post, Platform, Media } from "@simple-post/sdk";

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}

/**
 * Maps scheduler platform names to SDK platform names
 */
function mapPlatformName(platform: string): Platform {
  const platformMap: Record<string, Platform> = {
    x: "x",
    twitter: "x",
    youtube: "youtube",
    telegram: "telegram",
    facebook: "facebook",
    instagram: "instagram",
    tiktok: "tiktok",
    bluesky: "bluesky",
    threads: "threads",
    linkedin: "linkedin",
    pinterest: "pinterest",
  };

  return (platformMap[platform.toLowerCase()] as Platform) || (platform as Platform);
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
      // Instagram post URLs use shortcodes, not IDs directly
      // The ID format is different, but we'll try to construct a URL
      return `https://www.instagram.com/p/${postId}/`;
    }
    case "tiktok": {
      return `https://www.tiktok.com/@${account?.username || "user"}/video/${postId}`;
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
      return `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}`;
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

/**
 * Posts content to a single account using the SDK with pre-prepared media
 */
async function postToAccountWithPreparedMedia(
  message: string,
  preparedMedia: Media[],
  account: ConnectedAccount,
  accountOptions?: AccountOptionsMap,
): Promise<PostingResult> {
  const startTime = Date.now();
  const log = postingLogger.child({
    fn: "postToAccountWithPreparedMedia",
    accountId: account.id,
    platform: account.platform,
  });

  log.info({ messageLength: message.length, mediaCount: preparedMedia.length }, "Starting post to platform");

  try {
    const platform = mapPlatformName(account.platform);
    log.debug({ mappedPlatform: platform }, "Platform mapped");

    log.debug("Building post options");
    const options = buildPostOptions(account, accountOptions);
    log.debug("Post options built successfully");

    // Prepare media with proper titles for YouTube videos
    const processedMedia = preparedMedia.map((m) => {
      if (m.type === "video" && platform === "youtube" && !m.title) {
        // Ensure YouTube videos have a title
        return {
          ...m,
          title: message.trim() || "Untitled Video",
          description: message.trim() || undefined,
        };
      }
      return m;
    });

    const postData: Post = {
      content: {
        text: message,
        media: processedMedia.length > 0 ? processedMedia : undefined,
      },
      platforms: [platform],
      options,
    };

    log.debug("Calling SDK post function");

    // Prepare sanitized post data for logging
    const sanitizedPostData = {
      content: {
        text: postData.content.text,
        media: postData.content.media?.map((m) =>
          m.type === "video"
            ? {
                type: m.type,
                url: m.url,
                title: m.title,
                description: m.description,
                thumbnailUrl: m.thumbnailUrl,
              }
            : {
                type: m.type,
                url: m.url,
                caption: m.caption,
              },
        ),
      },
      platforms: postData.platforms,
      options: options ? redact(options as Record<string, unknown>) : undefined,
    };

    log.debug({ postData: sanitizedPostData }, "SDK post() call data");

    const results = await sdkPost(postData);
    const result = results.get(platform);

    const refreshedCredentials = result?.extraData?.refreshedCredentials;
    const platformLower = account.platform.toLowerCase();
    if (
      refreshedCredentials &&
      (platformLower === "x" || platformLower === "instagram" || platformLower === "bluesky")
    ) {
      try {
        await prisma.connectedAccount.update({
          where: { id: account.id },
          data: {
            ...encryptConnectedAccountSecrets({
              accessToken: refreshedCredentials.accessToken || account.accessToken,
              refreshToken: refreshedCredentials.refreshToken ?? account.refreshToken,
            }),
            expiresAt: refreshedCredentials.expiresAt
              ? new Date(refreshedCredentials.expiresAt * 1000)
              : account.expiresAt,
          },
        });
        log.info({ accountId: account.id, platform: account.platform }, "Updated credentials from refresh");
      } catch (updateError) {
        log.warn({ err: serializeError(updateError), accountId: account.id }, "Failed to update credentials");
      }
    }

    log.debug(
      {
        id: result?.id,
        error: result?.error,
        message: result?.message,
        hasDetails: !!result?.details,
        hasExtraData: !!result?.extraData,
      },
      "SDK post completed",
    );

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      const postUrl = generatePostUrl(platform, result.id, account);
      const durationMs = Date.now() - startTime;

      log.info(
        {
          postId: result.id,
          postUrl: postUrl || null,
          durationMs,
          credentialsRefreshed: !!result.extraData?.refreshedCredentials,
        },
        "Post successful",
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
    } else {
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
        "Post failed",
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
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    const durationMs = Date.now() - startTime;

    log.error({ err: serializeError(error), durationMs }, "Exception occurred while posting");

    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: errorMessage,
    };
  }
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

/**
 * Posts content to multiple accounts
 */
export async function postToAccounts(
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  accountOverrides?: AccountOverridesMap,
): Promise<PostingResult[]> {
  const startTime = Date.now();
  const log = postingLogger.child({ fn: "postToAccounts" });

  log.info(
    { accountCount: accountIds.length, accountIds, mediaFileCount: mediaFiles.length },
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
