import {
  buildReplyOverlay,
  extractChainStep,
  isThreadCapable,
  isRepostCapablePlatform,
  post as sdkPost,
  prepareMedia,
  PostErrorType,
  repost as sdkRepost,
} from "@simple-post/sdk";
import { generatePostUrl } from "@simple-post/sdk/platform-names";

import { buildPostOptions } from "./credentials.js";
import { rewriteOwnUrlToPath } from "./uploads.js";

import { getAccountsByIds, type ConfiguredAccount } from "../config/accounts.js";

import type {
  AccountOptionsMap,
  AccountOverridesMap,
  Media,
  MediaFile,
  Platform,
  Post,
  PostingResult,
  PostingSummary,
  RepostTarget,
  RepostTargetsMap,
  ThreadChainState,
  ThreadSegment,
  ThreadSegmentResult,
} from "@simple-post/sdk";

function mapMediaFilesToSdk(mediaFiles: MediaFile[]): Media[] {
  return mediaFiles.map((file): Media => {
    const url = rewriteOwnUrlToPath(file.url);
    if (file.type === "image") {
      return url.kind === "path"
        ? { type: "image", path: url.path, size: file.size }
        : { type: "image", url: file.url, size: file.size };
    }
    const thumb = file.thumbnailUrl ? rewriteOwnUrlToPath(file.thumbnailUrl) : undefined;
    let thumbField: { thumbnailPath: string } | { thumbnailUrl: string } | Record<string, never> = {};
    if (thumb?.kind === "path") {
      thumbField = { thumbnailPath: thumb.path };
    } else if (file.thumbnailUrl) {
      thumbField = { thumbnailUrl: file.thumbnailUrl };
    }
    if (url.kind === "path") {
      return { type: "video", path: url.path, size: file.size, durationSec: file.durationSec, ...thumbField };
    }
    return { type: "video", url: file.url, size: file.size, durationSec: file.durationSec, ...thumbField };
  });
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
  overlay: ReturnType<typeof buildReplyOverlay>
) {
  if (!overlay) return options;
  const existing = (options as Record<string, Record<string, unknown> | undefined>)[overlay.platform] ?? {};
  return {
    ...options,
    [overlay.platform]: { ...existing, ...overlay.options },
  };
}

async function postToAccountWithPreparedMedia(
  message: string,
  preparedMedia: Media[],
  account: ConfiguredAccount,
  accountOptions?: AccountOptionsMap
): Promise<PostingResult> {
  try {
    const options = buildPostOptions(account, accountOptions);
    const processedMedia = applyYouTubeDefaults(preparedMedia, message, account.platform);

    const postData: Post = {
      content: { text: message, media: processedMedia.length > 0 ? processedMedia : undefined },
      platforms: [account.platform],
      options,
    };

    const results = await sdkPost(postData);
    const result = results.get(account.platform);

    if (result?.error === PostErrorType.NO_ERROR && result?.id) {
      const postUrl =
        result.url ??
        generatePostUrl(account.platform, result.id, {
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

interface AccountSegment {
  message: string;
  mediaFiles: MediaFile[];
}

async function postSegmentsToAccount(
  segments: AccountSegment[],
  account: ConfiguredAccount,
  accountOptions?: AccountOptionsMap
): Promise<PostingResult> {
  const threadAware = isThreadCapable(account.platform);
  const effectiveSegments = threadAware ? segments : segments.slice(0, 1);

  const chain: ThreadChainState = {};
  const segmentResults: ThreadSegmentResult[] = [];
  let rootResult: PostingResult | undefined;

  for (const [i, segment] of effectiveSegments.entries()) {
    const media = mapMediaFilesToSdk(segment.mediaFiles);

    const tempPost: Post = {
      content: { text: segment.message, media: media.length > 0 ? media : undefined },
      platforms: [account.platform],
    };

    const { post: preparedPost, cleanup } = await prepareMedia(tempPost);
    let segmentResult: PostingResult;
    try {
      const preparedMedia = preparedPost.content.media || [];
      const baseOptions = buildPostOptions(account, accountOptions);
      const overlay = buildReplyOverlay(account.platform, chain);
      const options = mergeReplyOverlay(baseOptions, overlay);
      const processedMedia = applyYouTubeDefaults(preparedMedia, segment.message, account.platform);

      const postData: Post = {
        content: { text: segment.message, media: processedMedia.length > 0 ? processedMedia : undefined },
        platforms: [account.platform],
        options,
      };

      const results = await sdkPost(postData);
      const result = results.get(account.platform);

      if (result?.error === PostErrorType.NO_ERROR && result?.id) {
        const postUrl =
          result.url ??
          generatePostUrl(account.platform, result.id, {
            username: account.username,
            platformAccountId: account.platformAccountId,
          });
        segmentResult = {
          accountId: account.id,
          platform: account.platform,
          success: true,
          postId: result.id,
          postUrl,
          message: result.message,
          details: result.details,
        };

        // Advance the chain for the next segment.
        const step = extractChainStep(account.platform, result);
        if (step) {
          if (step.postId) chain.parentPostId = step.postId;
          if (step.bskyRef) {
            chain.parentBskyRef = step.bskyRef;
            if (i === 0) chain.rootBskyRef = step.bskyRef;
          }
        }
      } else {
        const errorMsg = result?.error || "Unknown error occurred";
        segmentResult = {
          accountId: account.id,
          platform: account.platform,
          success: false,
          error: errorMsg,
          message: result?.message ?? errorMsg,
          details: result?.details,
        };
      }
    } catch (error) {
      segmentResult = {
        accountId: account.id,
        platform: account.platform,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
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

    // Stop the chain on first failure — replies need their parent to exist.
    if (!segmentResult.success) break;
  }

  const overallSuccess = segmentResults.every((s) => s.success);
  const base = rootResult ?? {
    accountId: account.id,
    platform: account.platform,
    success: false,
    error: "No segments to post",
  };

  // Only attach threadResults if this account actually posted more than one
  // segment (or attempted to).
  if (effectiveSegments.length > 1) {
    return {
      ...base,
      success: overallSuccess,
      threadResults: segmentResults,
    };
  }
  return base;
}

function buildAccountSegments(
  account: ConfiguredAccount,
  rootMessage: string,
  rootMediaFiles: MediaFile[],
  sharedThread: ThreadSegment[],
  accountOverrides?: AccountOverridesMap
): AccountSegment[] {
  const override = accountOverrides?.[account.id];
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

export async function postToAccounts(
  message: string,
  mediaFiles: MediaFile[],
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  accountOverrides?: AccountOverridesMap,
  thread?: ThreadSegment[]
): Promise<PostingResult[]> {
  const accounts = getAccountsByIds(accountIds);
  if (accounts.length === 0) {
    throw new Error("No accounts found");
  }

  const hasOverrides = !!accountOverrides && Object.keys(accountOverrides).length > 0;
  const sharedThread = thread ?? [];
  const hasThread =
    sharedThread.length > 0 || Object.values(accountOverrides ?? {}).some((o) => (o.thread ?? []).length > 0);

  // Thread path: walk segments per account sequentially.
  if (hasThread) {
    return Promise.all(
      accounts.map((account) => {
        const segments = buildAccountSegments(account, message, mediaFiles, sharedThread, accountOverrides);
        return postSegmentsToAccount(segments, account, accountOptions);
      })
    );
  }

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

async function repostToAccount(
  account: ConfiguredAccount,
  target: RepostTarget,
  accountOptions?: AccountOptionsMap
): Promise<PostingResult> {
  if (!isRepostCapablePlatform(account.platform)) {
    return {
      accountId: account.id,
      platform: account.platform,
      success: false,
      error: PostErrorType.INVALID_CONTENT,
      message: `${account.platform} does not support reposting through SimplePost.`,
    };
  }

  try {
    const results = await sdkRepost({
      target,
      platforms: [account.platform],
      options: buildPostOptions(account, accountOptions),
    });
    const result = results.get(account.platform);

    if (result?.error === PostErrorType.NO_ERROR) {
      const postUrl =
        result.url ??
        (result.id
          ? generatePostUrl(account.platform, result.id, {
              username: account.username,
              platformAccountId: account.platformAccountId,
            })
          : undefined);
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

export async function repostToAccounts(
  accountIds: string[],
  target?: RepostTarget,
  accountTargets?: RepostTargetsMap,
  accountOptions?: AccountOptionsMap
): Promise<PostingResult[]> {
  const accounts = getAccountsByIds(accountIds);
  if (accounts.length === 0) {
    throw new Error("No accounts found");
  }

  return Promise.all(
    accounts.map((account) => {
      const accountTarget = accountTargets?.[account.id] ?? target;
      if (!accountTarget) {
        return Promise.resolve({
          accountId: account.id,
          platform: account.platform,
          success: false,
          error: PostErrorType.INVALID_CONTENT,
          message: "No repost target was provided for this account.",
        });
      }
      return repostToAccount(account, accountTarget, accountOptions);
    })
  );
}
