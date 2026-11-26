import { getPublisher } from "./publishers";
import { PostError, PostErrorType } from "./types";
import { readinessFailure } from "./utils/account-readiness";
import { getCredentialsFromEnv, mergeOptions } from "./utils/credentials";
import { fitPostImages } from "./utils/image-fitting";
import { MediaResolver } from "./utils/media-resolver";
import { validatePostMedia, type MediaInspectionCache } from "./utils/post-media-validation";

import type { AccountAnalyticsResponse, AnalyticsTarget, PostAnalyticsResponse } from "./analytics";
import type { PostResult, QuoteResult, RepostResult } from "./types";
import type { PostOptions, Content, Platform, Post, Quote, Repost } from "./types/post";
import type { ValidationIssue } from "./types/validation";

export interface PreparedPost {
  post: Post;
  cleanup: () => Promise<void>;
}

// Publisher construction can fail before Publisher.post/repost/quote gets a
// chance to normalize errors (for example when credentials are missing).
// Preserve the results of other destinations even when that happens.
async function runForPlatform(publish: () => Promise<PostResult>): Promise<PostResult> {
  try {
    return await publish();
  } catch (error) {
    if (error instanceof PostError) {
      return { error: error.errorType, message: error.message, details: error.details };
    }
    return {
      error: PostErrorType.OTHER,
      message: error instanceof Error ? error.message : "Unknown publishing error",
    };
  }
}

/**
 * Pre-resolves media for multi-platform posting.
 * Downloads URLs to files or uploads files to URLs as needed based on platform requirements.
 * Uses promise-based caching to avoid duplicate operations.
 *
 * @param post - The post content with platforms and media
 * @returns Prepared post with resolved media and cleanup function
 *
 * @example
 * ```typescript
 * const { post: prepared, cleanup } = await prepareMedia({
 *   platforms: ["youtube", "x", "facebook"],
 *   content: { media: [{ type: "video", url: "https://..." }] }
 * });
 *
 * try {
 *   await post(prepared);
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function prepareMedia(post: Post): Promise<PreparedPost> {
  const resolver = new MediaResolver();

  try {
    // Resolve media based on platform requirements
    const resolvedMedia = post.content.media ? await resolver.resolve(post.content.media, post.platforms) : undefined;

    // Build resolved content
    const resolvedContent: Content = {
      text: post.content.text,
      media: resolvedMedia,
    };

    // Build resolved post
    const resolvedPost: Post = {
      ...post,
      content: resolvedContent,
      platforms: post.platforms,
      options: post.options,
    };

    return {
      post: resolvedPost,
      cleanup: async () => {
        await resolver.cleanup();
      },
    };
  } catch (error) {
    // Cleanup on error
    await resolver.cleanup();
    throw error;
  }
}

export async function post(post: Post): Promise<Map<Platform, PostResult>> {
  if (post.imageFit) {
    let fitted: PreparedPost;
    try {
      fitted = await fitPostImages(post, post.imageFit);
    } catch (error) {
      return new Map(
        post.platforms.map((platform) => [
          platform,
          {
            error: PostErrorType.PREPARATION_ERROR,
            message: error instanceof Error ? error.message : "Could not fit images.",
          },
        ]),
      );
    }
    try {
      return await publishFittedPost(fitted.post);
    } finally {
      await fitted.cleanup();
    }
  }
  return publishFittedPost(post);
}

async function publishFittedPost(post: Post): Promise<Map<Platform, PostResult>> {
  const results = new Map<Platform, PostResult>();
  const envCredentials = getCredentialsFromEnv();
  const mergedOptions = mergeOptions(envCredentials, post.options);
  const cache: MediaInspectionCache = new Map();
  const failures = await validatePostMedia({ ...post, options: mergedOptions }, cache);

  for (const platform of post.platforms) {
    results.set(
      platform,
      failures.some((failure) => failure.platform === platform && failure.severity === "error")
        ? {
            error: PostErrorType.INVALID_CONTENT,
            message: failures
              .filter((failure) => failure.platform === platform && failure.severity === "error")
              .map((failure) => failure.message)
              .join(" "),
            details: failures.filter((failure) => failure.platform === platform && failure.severity === "error"),
          }
        : await runForPlatform(() => getPublisher(platform, mergedOptions).post(post.content, mergedOptions, cache)),
    );
  }

  return results;
}

export async function repost(repostRequest: Repost): Promise<Map<Platform, RepostResult>> {
  const results = new Map<Platform, RepostResult>();
  const envCredentials = getCredentialsFromEnv();
  const mergedOptions = mergeOptions(envCredentials, repostRequest.options);

  for (const platform of repostRequest.platforms) {
    results.set(
      platform,
      await runForPlatform(() => getPublisher(platform, mergedOptions).repost(repostRequest.target, mergedOptions)),
    );
  }

  return results;
}

/**
 * Publishes content as a native quote on supported platforms. Publishers that
 * do not support native quotes deliberately fall back to an ordinary post.
 */
export async function quote(quoteRequest: Quote): Promise<Map<Platform, QuoteResult>> {
  const results = new Map<Platform, QuoteResult>();
  const envCredentials = getCredentialsFromEnv();
  const mergedOptions = mergeOptions(envCredentials, quoteRequest.options);
  const cache: MediaInspectionCache = new Map();
  const failures = await validatePostMedia({ ...quoteRequest, options: mergedOptions }, cache);

  for (const platform of quoteRequest.platforms) {
    results.set(
      platform,
      failures.some((failure) => failure.platform === platform && failure.severity === "error")
        ? {
            error: PostErrorType.INVALID_CONTENT,
            message: failures
              .filter((failure) => failure.platform === platform && failure.severity === "error")
              .map((failure) => failure.message)
              .join(" "),
            details: failures.filter((failure) => failure.platform === platform && failure.severity === "error"),
          }
        : await runForPlatform(() => {
            const publisher = getPublisher(platform, mergedOptions);
            const target = quoteRequest.targets?.[platform] ?? quoteRequest.target;
            return target
              ? publisher.quote(quoteRequest.content, target, mergedOptions, cache)
              : publisher.post(quoteRequest.content, mergedOptions, cache);
          }),
    );
  }

  return results;
}

export interface PostAnalyticsRequest {
  platform: Platform;
  /** Posts to read, identified by the ids returned when they were published. */
  targets: AnalyticsTarget[];
  /** Credentials for the account that published the posts (merged over environment credentials). */
  options?: PostOptions;
}

export interface AccountAnalyticsRequest {
  platform: Platform;
  options?: PostOptions;
}

function analyticsCredentialFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not create the platform client.";
}

/**
 * Reads unified analytics (views, likes, comments, shares, …) for published
 * posts. Never throws: every target gets a result whose `status` says whether
 * metrics were read. Platforms that refresh tokens themselves return
 * `refreshedCredentials`, which callers should persist.
 *
 * @example
 * ```typescript
 * const { results } = await getPostAnalytics({
 *   platform: "x",
 *   targets: [{ postId: "1790000000000000000" }],
 *   options: { x: { credentials: { accessToken } } },
 * });
 * console.log(results[0].metrics.views, results[0].metrics.likes);
 * ```
 */
export async function getPostAnalytics(request: PostAnalyticsRequest): Promise<PostAnalyticsResponse> {
  const options = mergeOptions(getCredentialsFromEnv(), request.options);
  try {
    return await getPublisher(request.platform, options).getPostAnalytics(request.targets, options);
  } catch (error) {
    const fetchedAt = new Date().toISOString();
    return {
      platform: request.platform,
      results: request.targets.map((target) => ({
        platform: request.platform,
        postId: target.postId,
        status: "credentials_error" as const,
        metrics: {},
        message: analyticsCredentialFailureMessage(error),
        fetchedAt,
      })),
    };
  }
}

/** Reads account-level analytics such as follower counts. Never throws. */
export async function getAccountAnalytics(request: AccountAnalyticsRequest): Promise<AccountAnalyticsResponse> {
  const options = mergeOptions(getCredentialsFromEnv(), request.options);
  try {
    return await getPublisher(request.platform, options).getAccountAnalytics(options);
  } catch (error) {
    return {
      platform: request.platform,
      status: "credentials_error",
      metrics: {},
      message: analyticsCredentialFailureMessage(error),
      fetchedAt: new Date().toISOString(),
    };
  }
}

// Export publisher classes - use static methods for validation
export { XPublisher } from "./publishers/x";
export { BlueskyPublisher } from "./publishers/bluesky";
export { ThreadsPublisher } from "./publishers/threads";
export { FacebookPublisher } from "./publishers/facebook";
export { InstagramPublisher } from "./publishers/instagram";
export { TelegramPublisher } from "./publishers/telegram";
export { TikTokPublisher } from "./publishers/tiktok";
export { YouTubePublisher } from "./publishers/youtube";
export { LinkedInPublisher } from "./publishers/linkedin";
export { PinterestPublisher } from "./publishers/pinterest";
export { ForemPublisher } from "./publishers/forem";

// Export all types for TypeScript and JavaScript users
export type {
  Platform,
  Post,
  Repost,
  RepostTarget,
  Quote,
  QuoteTarget,
  QuoteTargets,
  Content,
  Media,
  Image,
  Video,
  PostOptions,
  PostOptionsWithCredentials,
  CommonOptions,
  XOptions,
  TelegramOptions,
  YouTubeOptions,
  FacebookOptions,
  StoryPlacement,
  InstagramOptions,
  TikTokOptions,
  TikTokPrivacyLevel,
  BlueskyOptions,
  BlueskyPostRef,
  BlueskyReplyRef,
  ThreadsOptions,
  LinkedInOptions,
  PinterestOptions,
  ForemOptions,
  LogLevel,
} from "./types/post";

export type { PostResult, QuoteResult, RepostResult } from "./types";

// Unified analytics model (also available as the browser-safe subpath export
// @simple-post/sdk/analytics).
export * from "./analytics";
export { AnalyticsError } from "./utils/analytics";
export { PostError, PostErrorType } from "./types";
export type { PlatformValidationRules, ValidationIssue, ValidationResult } from "./types/validation";

// Shared HTTP API contract — request schemas and response types used by
// the @simple-post/server and @simple-post/scheduler HTTP APIs.
export {
  MediaFileSchema,
  AccountOptionsValueSchema,
  AccountOptionsMapSchema,
  PlacementResultSchema,
  AccountIdsSchema,
  AccountContentOverrideSchema,
  AccountOverridesMapSchema,
  createPostSchema,
  validationRequestSchema,
  ThreadSegmentSchema,
  ThreadSchema,
  MAX_THREAD_SEGMENTS,
  THREAD_CAPABLE_PLATFORMS,
  isThreadCapablePlatform,
  RepostSettingsSchema,
  repostPostSchema,
  REPOST_CAPABLE_PLATFORMS,
  isRepostCapablePlatform,
} from "./types/api";
export type {
  MediaFile,
  AccountContentOverride,
  AccountOverridesMap,
  AccountOptionsMap,
  CreatePostInput,
  ValidationRequestInput,
  PostingResult,
  PostingSummary,
  ThreadSegment,
  ThreadSegmentResult,
  PlacementResult,
  ThreadCapablePlatform,
  RepostSettings,
  RepostPostInput,
  RepostTargetsMap,
  RepostCapablePlatform,
} from "./types/api";

// Shared platform-name aliasing, post URL construction, and accepted media
// content types (also available as browser-safe subpath exports
// @simple-post/sdk/platform-names and @simple-post/sdk/media-types).
export { mapPlatformName, generatePostUrl, QUOTE_CAPABLE_PLATFORMS, isQuoteCapablePlatform } from "./platform-names";
export type { PostUrlContext, QuoteCapablePlatform } from "./platform-names";
export {
  ALLOWED_MEDIA_TYPES,
  detectMediaType,
  EXTENSION_TO_TYPE,
  MAX_INSPECTABLE_IMAGE_BYTES,
  normalizeContentType,
} from "./media-types";
export { MediaResolver } from "./utils/media-resolver";
export { downloadToTempFile, getRemoteMediaSize } from "./utils/media";
export { hydrateRemoteMediaSizesForAccounts } from "./utils/remote-media-validation";
export type { RemoteMediaValidationAccount, RemoteMediaValidationParams } from "./utils/remote-media-validation";
export {
  TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES,
  TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES,
} from "./publishers/telegram/validation";
export { YOUTUBE_MAX_THUMBNAIL_SIZE_BYTES } from "./publishers/youtube/validation";

// Export utility functions
export { derToRaw } from "./utils/crypto";
export { createDpopProof } from "./utils/dpop";
export {
  S3MediaUploader,
  uploadFromBuffer,
  getPresignedUploadUrl,
  deleteFromStorage,
  getKeyFromUrl,
  getOwnedStorageKeyFromUrl,
  generateFileKey,
} from "./utils/s3";
export { buildReplyOverlay, extractChainStep, isThreadCapable } from "./utils/thread";
export type { ThreadChainState, ReplyOverlay } from "./utils/thread";
export { getValidationRulesForPlatform, validateContentForPlatform } from "./validation";

// Export schemas for runtime validation
export {
  PlatformSchema,
  PostSchema,
  RepostSchema,
  RepostTargetSchema,
  QuoteSchema,
  QuoteTargetSchema,
  ContentSchema,
  MediaSchema,
  ImageSchema,
  VideoSchema,
  PostOptionsSchema,
  CommonOptionsSchema,
  XOptionsSchema,
  TelegramOptionsSchema,
  YouTubeOptionsSchema,
  FacebookOptionsSchema,
  StoryPlacementSchema,
  InstagramOptionsSchema,
  TikTokOptionsSchema,
  TikTokPrivacyLevelSchema,
  BlueskyOptionsSchema,
  BlueskyPostRefSchema,
  BlueskyReplyRefSchema,
  ThreadsOptionsSchema,
  LinkedInOptionsSchema,
  PinterestOptionsSchema,
  ForemOptionsSchema,
} from "./types/post";

export { validatePostMedia } from "./utils/post-media-validation";
export { getMetaCredentialRejection, isMetaCredentialPlatform } from "./utils/meta-credential-rejection";
export type { MetaCredentialPlatform } from "./utils/meta-credential-rejection";
export type { CredentialRejection } from "./types/validation";

/** Check current account capabilities without uploading media or creating a post. */
export async function validatePostReadiness(
  platform: Platform,
  content: Content,
  options?: PostOptions,
): Promise<ValidationIssue[]> {
  try {
    const merged = mergeOptions(getCredentialsFromEnv(), options);
    return await getPublisher(platform, merged).validateReadiness(content, merged);
  } catch (error) {
    return [readinessFailure(platform, error)];
  }
}

export { ImageFitSchema, canFitImageIssue, IMAGE_FIT_HELP } from "./image-fit";
export type { ImageFit } from "./image-fit";
export { fitImage, fitPostImages, fitRemoteImagesForAccounts, ImageFitError } from "./utils/image-fitting";
export type { ImageFitContent } from "./utils/image-fitting";

export {
  describeDisplayMessage,
  displayMessage,
  getDisplayMessage,
  copyDisplayMessage,
  canonicalDisplayMessage,
  withDisplayMessage,
} from "./validation/display-message";
export type { DisplayMessage, DisplayValues } from "./validation/display-message";

export {
  getSocialActivityCapabilities,
  getSocialActivityProvider,
  listSocialPostComments,
  listSocialPostQuotes,
  likeSocialItem,
  replyToSocialComment,
} from "./social";
export type * from "./types/social";
