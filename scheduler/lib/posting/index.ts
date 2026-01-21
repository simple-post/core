import { PostErrorType, post as sdkPost } from "@simple-post/sdk";

import { postingLogger, serializeError, redact } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/utils/file-download";
import type { ConnectedAccount, MediaFile, AccountOptionsMap } from "@/types";

import { buildPostOptions } from "./credentials";

import type { Post, Platform, Media } from "@simple-post/sdk";

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: any;
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
  };

  return (platformMap[platform.toLowerCase()] as Platform) || (platform as Platform);
}

/**
 * Converts scheduler media files to SDK media format
 * @param mediaFiles - Media files from the scheduler
 * @param message - The post message text (used as fallback title for videos)
 */
async function convertMedia(mediaFiles: MediaFile[], message: string): Promise<Media[]> {
  const log = postingLogger.child({ fn: "convertMedia" });
  log.debug({ mediaCount: mediaFiles.length }, "Converting media files to SDK format");

  const media: Media[] = [];

  for (const file of mediaFiles) {
    log.debug({ type: file.type, filename: file.filename }, "Processing media file");

    // Download the file from R2 to a temporary location
    log.debug({ url: file.url }, "Downloading file from R2");
    const localPath = await downloadFile(file.url, file.filename);
    log.debug({ localPath }, "File downloaded to temporary path");

    if (file.type === "image") {
      media.push({
        type: "image",
        path: localPath,
      });
      log.debug({ localPath }, "Added image media");
    } else if (file.type === "video") {
      const videoMedia: Media = {
        type: "video",
        path: localPath,
        // For YouTube, title is required. Use message text as title if available
        title: message.trim() || file.filename.replace(/\.[^/.]+$/, ""),
        // Use message as description for videos
        description: message.trim() || undefined,
      };

      log.debug({ title: videoMedia.title }, "Video title set");

      // Add thumbnail if available
      if (file.thumbnailUrl) {
        log.debug({ thumbnailUrl: file.thumbnailUrl }, "Downloading thumbnail");
        const thumbnailPath = await downloadFile(
          file.thumbnailUrl,
          `thumbnail_${file.filename.replace(/\.[^/.]+$/, ".jpg")}`,
        );
        videoMedia.thumbnailPath = thumbnailPath;
        log.debug({ thumbnailPath }, "Thumbnail downloaded");
      }

      media.push(videoMedia);
      log.debug({ localPath }, "Added video media");
    }
  }

  log.debug({ totalMediaItems: media.length }, "Conversion complete");
  return media;
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
    default: {
      postingLogger.warn({ platform }, "Unknown platform for URL generation");
      return undefined;
    }
  }
}

/**
 * Posts content to a single account using the SDK
 */
async function postToAccount(
  message: string,
  media: Media[],
  account: ConnectedAccount,
  accountOptions?: AccountOptionsMap,
): Promise<PostingResult> {
  const startTime = Date.now();
  const log = postingLogger.child({
    fn: "postToAccount",
    accountId: account.id,
    platform: account.platform,
  });

  log.info({ messageLength: message.length, mediaCount: media.length }, "Starting post to platform");

  try {
    const platform = mapPlatformName(account.platform);
    log.debug({ mappedPlatform: platform }, "Platform mapped");

    log.debug("Building post options");
    const options = buildPostOptions(account, accountOptions);
    log.debug("Post options built successfully");

    // Prepare media with proper titles for YouTube videos
    const processedMedia = media.map((m) => {
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
        media: postData.content.media?.map((m) => ({
          type: m.type,
          path: m.path,
          title: m.type === "video" ? (m as any).title : undefined,
          description: m.type === "video" ? (m as any).description : undefined,
          thumbnailPath: m.type === "video" ? (m as any).thumbnailPath : undefined,
          caption: m.type === "image" ? (m as any).caption : undefined,
        })),
      },
      platforms: postData.platforms,
      options: options ? redact(options as Record<string, unknown>) : undefined,
    };

    log.debug({ postData: sanitizedPostData }, "SDK post() call data");

    const results = await sdkPost(postData);
    const result = results.get(platform);

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
          details: result?.details,
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

/**
 * Posts content to multiple accounts
 */
export async function postToAccounts(
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
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
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        id: {
          in: accountIds,
        },
      },
    });

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

    // Convert media files to SDK format
    log.debug("Converting media files to SDK format");
    const media = await convertMedia(mediaFiles, message);
    log.debug({ mediaItemCount: media.length }, "Media conversion complete");

    // Post to all accounts in parallel
    log.debug("Posting to all accounts in parallel");
    const results = await Promise.all(
      accounts.map((account) => postToAccount(message, media, account, accountOptions)),
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
