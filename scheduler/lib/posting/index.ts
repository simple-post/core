import { PostErrorType, post as sdkPost } from "@simple-post/sdk";
import type { Post, Platform, Media } from "@simple-post/sdk";
import { prisma } from "@/lib/prisma";
import type { ConnectedAccount, MediaFile, AccountOptionsMap } from "@/types";
import { downloadFile } from "@/lib/utils/file-download";
import { buildPostOptions } from "./credentials";

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
  console.log(`[convertMedia] Converting ${mediaFiles.length} media file(s) to SDK format`);

  const media: Media[] = [];

  for (const file of mediaFiles) {
    console.log(`[convertMedia] Processing ${file.type} file: ${file.filename}`);

    // Download the file from R2 to a temporary location
    console.log(`[convertMedia] Downloading file from R2: ${file.url}`);
    const localPath = await downloadFile(file.url, file.filename);
    console.log(`[convertMedia] File downloaded to temporary path: ${localPath}`);

    if (file.type === "image") {
      media.push({
        type: "image",
        path: localPath,
      });
      console.log(`[convertMedia] Added image media: ${localPath}`);
    } else if (file.type === "video") {
      const videoMedia: Media = {
        type: "video",
        path: localPath,
        // For YouTube, title is required. Use message text as title if available
        title: message.trim() || file.filename.replace(/\.[^/.]+$/, ""),
        // Use message as description for videos
        description: message.trim() || undefined,
      };

      console.log(`[convertMedia] Video title set to: "${videoMedia.title}"`);

      // Add thumbnail if available
      if (file.thumbnailUrl) {
        console.log(`[convertMedia] Downloading thumbnail: ${file.thumbnailUrl}`);
        const thumbnailPath = await downloadFile(
          file.thumbnailUrl,
          `thumbnail_${file.filename.replace(/\.[^/.]+$/, ".jpg")}`,
        );
        videoMedia.thumbnailPath = thumbnailPath;
        console.log(`[convertMedia] Thumbnail downloaded to: ${thumbnailPath}`);
      }

      media.push(videoMedia);
      console.log(`[convertMedia] Added video media: ${localPath}`);
    }
  }

  console.log(`[convertMedia] Conversion complete. Total media items: ${media.length}`);
  return media;
}

/**
 * Generates a post URL for a platform based on the post ID
 */
function generatePostUrl(platform: string, postId: string, account?: ConnectedAccount): string | undefined {
  console.log(`[generatePostUrl] Generating URL for platform: ${platform}, postId: ${postId}`);

  const platformLower = platform.toLowerCase();

  switch (platformLower) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${postId}`;
    case "x":
    case "twitter":
      // X/Twitter post URLs require username, but we can construct a basic URL
      const username = account?.username || account?.platformAccountId || "";
      return username ? `https://x.com/${username.replace("@", "")}/status/${postId}` : undefined;
    case "facebook":
      // Facebook post URLs typically need page ID and post ID
      const pageId = account?.platformAccountId || "";
      return pageId ? `https://www.facebook.com/${pageId}/posts/${postId}` : undefined;
    case "instagram":
      // Instagram post URLs use shortcodes, not IDs directly
      // The ID format is different, but we'll try to construct a URL
      return `https://www.instagram.com/p/${postId}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${account?.username || "user"}/video/${postId}`;
    case "telegram":
      // Telegram doesn't have public URLs for posts, but we can link to the channel
      const chatId = account?.platformAccountId || "";
      if (chatId.startsWith("@")) {
        return `https://t.me/${chatId.replace("@", "")}/${postId}`;
      }
      return undefined;
    default:
      console.warn(`[generatePostUrl] Unknown platform: ${platform}`);
      return undefined;
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
  console.log(`[postToAccount] Starting post to ${account.platform} (accountId: ${account.id})`);
  console.log(`[postToAccount] Message length: ${message.length} characters`);
  console.log(`[postToAccount] Media count: ${media.length}`);

  try {
    const platform = mapPlatformName(account.platform);
    console.log(`[postToAccount] Mapped platform: ${platform}`);

    console.log(`[postToAccount] Building post options for ${platform}`);
    const options = buildPostOptions(account, accountOptions);
    console.log(`[postToAccount] Post options built successfully`);

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

    console.log(`[postToAccount] Calling SDK post function for ${platform}`);

    // Prepare sanitized options for logging (mask credentials)
    const sanitizedOptions: Record<string, any> = {};
    if (options) {
      Object.keys(options).forEach((key) => {
        const platformOptions = (options as any)[key];
        if (platformOptions && typeof platformOptions === "object") {
          sanitizedOptions[key] = Object.keys(platformOptions).reduce((acc: any, optKey: string) => {
            if (optKey === "credentials") {
              acc[optKey] = "[REDACTED]";
            } else {
              acc[optKey] = platformOptions[optKey];
            }
            return acc;
          }, {});
        } else {
          sanitizedOptions[key] = platformOptions;
        }
      });
    }

    console.log(
      `[postToAccount] SDK post() call with data:`,
      JSON.stringify(
        {
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
          options: sanitizedOptions,
        },
        null,
        2,
      ),
    );

    const results = await sdkPost(postData);
    const result = results.get(platform);

    console.log(`[postToAccount] SDK post completed. Full result:`, {
      id: result?.id,
      error: result?.error,
      message: result?.message,
      details: result?.details,
      extraData: result?.extraData,
    });

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      const postUrl = generatePostUrl(platform, result.id, account);
      console.log(`[postToAccount] Post successful! Post ID: ${result.id}, URL: ${postUrl || "N/A"}`);
      if (result.message) {
        console.log(`[postToAccount] Success message: ${result.message}`);
      }
      if (result.extraData?.refreshedCredentials) {
        console.log(`[postToAccount] Credentials were refreshed during posting`);
      }
      console.log(`[postToAccount] Post completed in ${Date.now() - startTime}ms`);

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
      console.error(`[postToAccount] Post failed. Error: ${errorMsg}`);
      if (result?.message) {
        console.error(`[postToAccount] Error message: ${result.message}`);
      }
      if (result?.details) {
        console.error(`[postToAccount] Error details:`, result.details);
      }
      console.log(`[postToAccount] Post failed after ${Date.now() - startTime}ms`);

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
    console.error(`[postToAccount] Exception occurred while posting to ${account.platform}:`, error);
    console.error(`[postToAccount] Error details:`, {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.log(`[postToAccount] Exception occurred after ${Date.now() - startTime}ms`);

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
  console.log(`[postToAccounts] Starting post to ${accountIds.length} account(s)`);
  console.log(`[postToAccounts] Account IDs: ${accountIds.join(", ")}`);
  console.log(`[postToAccounts] Media files: ${mediaFiles.length}`);

  try {
    // Fetch all connected accounts
    console.log(`[postToAccounts] Fetching connected accounts from database`);
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        id: {
          in: accountIds,
        },
      },
    });

    console.log(`[postToAccounts] Found ${accounts.length} account(s) in database`);

    if (accounts.length === 0) {
      console.error(`[postToAccounts] No accounts found for the provided IDs`);
      throw new Error("No accounts found");
    }

    // Log account details
    accounts.forEach((account) => {
      console.log(
        `[postToAccounts] Account: ${account.platform} (${account.id}) - ${account.username || account.platformAccountId}`,
      );
    });

    // Convert media files to SDK format
    console.log(`[postToAccounts] Converting media files to SDK format`);
    const media = await convertMedia(mediaFiles, message);
    console.log(`[postToAccounts] Media conversion complete. ${media.length} media item(s) ready`);

    // Post to all accounts in parallel
    console.log(`[postToAccounts] Posting to all accounts in parallel`);
    const results = await Promise.all(
      accounts.map((account) => postToAccount(message, media, account, accountOptions)),
    );

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log(`[postToAccounts] Posting complete! Success: ${successCount}, Failed: ${failureCount}`);
    console.log(`[postToAccounts] Total time: ${Date.now() - startTime}ms`);

    // Log detailed results
    results.forEach((result) => {
      if (result.success) {
        console.log(`[postToAccounts] ✓ ${result.platform}:`, {
          postId: result.postId,
          postUrl: result.postUrl || "No URL",
          message: result.message || "No message",
          credentialsRefreshed: !!result.extraData?.refreshedCredentials,
        });
      } else {
        console.error(`[postToAccounts] ✗ ${result.platform}:`, {
          error: result.error,
          message: result.message || "No message",
          details: result.details || "No details",
        });
      }
    });

    return results;
  } catch (error) {
    console.error(`[postToAccounts] Fatal error in postToAccounts:`, error);
    console.error(`[postToAccounts] Error details:`, {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.log(`[postToAccounts] Failed after ${Date.now() - startTime}ms`);
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
