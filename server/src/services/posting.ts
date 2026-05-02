import { post as sdkPost, prepareMedia, PostErrorType } from "@simple-post/sdk";

import { buildPostOptions } from "./credentials.js";
import { rewriteOwnUrlToPath } from "./uploads.js";

import { getAccountsByIds, type ConfiguredAccount } from "../config/accounts.js";
import { generatePostUrl } from "../utils/platforms.js";

import type {
  AccountOptionsMap,
  AccountOverridesMap,
  Media,
  MediaFile,
  Platform,
  Post,
  PostingResult,
  PostingSummary,
} from "@simple-post/sdk";

function mapMediaFilesToSdk(mediaFiles: MediaFile[]): Media[] {
  return mediaFiles.map((file): Media => {
    const url = rewriteOwnUrlToPath(file.url);
    if (file.type === "image") {
      return url.kind === "path" ? { type: "image", path: url.path } : { type: "image", url: file.url };
    }
    const thumb = file.thumbnailUrl ? rewriteOwnUrlToPath(file.thumbnailUrl) : undefined;
    let thumbField: { thumbnailPath: string } | { thumbnailUrl: string } | Record<string, never> = {};
    if (thumb?.kind === "path") {
      thumbField = { thumbnailPath: thumb.path };
    } else if (file.thumbnailUrl) {
      thumbField = { thumbnailUrl: file.thumbnailUrl };
    }
    if (url.kind === "path") {
      return { type: "video", path: url.path, ...thumbField };
    }
    return { type: "video", url: file.url, ...thumbField };
  });
}

async function postToAccountWithPreparedMedia(
  message: string,
  preparedMedia: Media[],
  account: ConfiguredAccount,
  accountOptions?: AccountOptionsMap
): Promise<PostingResult> {
  try {
    const options = buildPostOptions(account, accountOptions);

    const processedMedia = preparedMedia.map((m) => {
      if (m.type === "video" && account.platform === "youtube" && !m.title) {
        return {
          ...m,
          title: message.trim() || "Untitled Video",
          description: message.trim() || undefined,
        };
      }
      return m;
    });

    const postData: Post = {
      content: { text: message, media: processedMedia.length > 0 ? processedMedia : undefined },
      platforms: [account.platform],
      options,
    };

    const results = await sdkPost(postData);
    const result = results.get(account.platform);

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      const postUrl = generatePostUrl(account.platform, result.id, {
        username: account.username,
        platformAccountId: account.platformAccountId,
      });
      return {
        accountId: account.id,
        platform: account.platform,
        success: true,
        postId: result.id,
        postUrl,
        message: result.message,
        details: result.details,
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
    };
  } catch (error) {
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function postToAccounts(
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  accountOverrides?: AccountOverridesMap
): Promise<PostingResult[]> {
  const accounts = getAccountsByIds(accountIds);
  if (accounts.length === 0) {
    throw new Error("No accounts found");
  }

  const hasOverrides = !!accountOverrides && Object.keys(accountOverrides).length > 0;

  if (!hasOverrides) {
    const media = mapMediaFilesToSdk(mediaFiles);
    const uniquePlatforms = [...new Set(accounts.map((account) => account.platform))] as Platform[];
    const tempPost: Post = {
      content: { text: message, media: media.length > 0 ? media : undefined },
      platforms: uniquePlatforms,
    };

    const { post: preparedPost, cleanup } = await prepareMedia(tempPost);

    try {
      const preparedMedia = preparedPost.content.media || [];
      return await Promise.all(
        accounts.map((account) => postToAccountWithPreparedMedia(message, preparedMedia, account, accountOptions))
      );
    } finally {
      await cleanup();
    }
  }

  return Promise.all(
    accounts.map(async (account) => {
      const override = accountOverrides?.[account.id];
      const accountMessage = override?.message ?? message;
      const accountMediaFiles = override?.media ?? mediaFiles;
      const media = mapMediaFilesToSdk(accountMediaFiles);

      const tempPost: Post = {
        content: { text: accountMessage, media: media.length > 0 ? media : undefined },
        platforms: [account.platform],
      };

      const { post: preparedPost, cleanup } = await prepareMedia(tempPost);

      try {
        const preparedMedia = preparedPost.content.media || [];
        return await postToAccountWithPreparedMedia(accountMessage, preparedMedia, account, accountOptions);
      } finally {
        await cleanup();
      }
    })
  );
}

export function getPostingSummary(results: PostingResult[]): PostingSummary {
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;
  return {
    successCount,
    failureCount,
    overallSuccess: successCount > 0 && failureCount === 0,
  };
}
