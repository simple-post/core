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
 */
async function convertMedia(mediaFiles: MediaFile[]): Promise<Media[]> {
  const media: Media[] = [];

  for (const file of mediaFiles) {
    // Download the file from R2 to a temporary location
    const localPath = await downloadFile(file.url, file.filename);

    if (file.type === "image") {
      media.push({
        type: "image",
        path: localPath,
      });
    } else if (file.type === "video") {
      const videoMedia: Media = {
        type: "video",
        path: localPath,
      };

      // Add thumbnail if available
      if (file.thumbnailUrl) {
        const thumbnailPath = await downloadFile(
          file.thumbnailUrl,
          `thumbnail_${file.filename.replace(/\.[^/.]+$/, ".jpg")}`,
        );
        videoMedia.thumbnailPath = thumbnailPath;
      }

      media.push(videoMedia);
    }
  }

  return media;
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
  try {
    const platform = mapPlatformName(account.platform);
    const options = buildPostOptions(account, accountOptions);

    const postData: Post = {
      content: {
        text: message,
        media: media.length > 0 ? media : undefined,
      },
      platforms: [platform],
      options,
    };

    const results = await sdkPost(postData);
    const result = results.get(platform);

    if (result?.error === PostErrorType.NO_ERROR) {
      return {
        accountId: account.id,
        platform: account.platform,
        success: true,
      };
    } else {
      return {
        accountId: account.id,
        platform: account.platform,
        success: false,
        error: result?.error || "Unknown error occurred",
      };
    }
  } catch (error) {
    console.error(`Error posting to ${account.platform}:`, error);
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
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
  try {
    // Fetch all connected accounts
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        id: {
          in: accountIds,
        },
      },
    });

    if (accounts.length === 0) {
      throw new Error("No accounts found");
    }

    // Convert media files to SDK format
    const media = await convertMedia(mediaFiles);

    // Post to all accounts in parallel
    const results = await Promise.all(
      accounts.map((account) => postToAccount(message, media, account, accountOptions)),
    );

    return results;
  } catch (error) {
    console.error("Error in postToAccounts:", error);
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
