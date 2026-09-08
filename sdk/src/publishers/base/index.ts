import fs from "node:fs";

import { PostError, PostErrorType } from "../../types";
import { checkAccountReadiness, readinessFailure } from "../../utils/account-readiness";
import { Logger } from "../../utils/logger";
import { validatePostMedia, type MediaInspectionCache } from "../../utils/post-media-validation";

import type { PostResult, QuoteResult, RepostResult } from "../../types";
import type {
  Content,
  Platform,
  PostOptions,
  PostOptionsWithCredentials,
  QuoteTarget,
  RepostTarget,
} from "../../types/post";
import type { ValidationIssue } from "../../types/validation";

export type MediaRequirement = "path" | "url" | "either";

export abstract class Publisher {
  readonly logger: Logger;
  readonly strictMode: boolean;
  protected readonly platform?: Platform;
  protected readonly initialOptions?: PostOptions;

  /**
   * Static property defining the media requirement for this publisher
   * - "path": Platform requires a local file path (downloads URLs)
   * - "url": Platform requires a public URL (uploads paths to S3/public storage)
   * - "either": Platform accepts both, but may prefer one
   */
  static readonly mediaRequirement: MediaRequirement;

  constructor(name: string, options?: PostOptions, platform?: Platform) {
    this.platform = platform;
    this.initialOptions = options;
    this.logger = new Logger(name, options?.common?.logLevel);
    this.strictMode = options?.common?.strictMode ?? false;
  }

  protected abstract postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult>;

  protected async repostContent(_target: RepostTarget, _options?: PostOptionsWithCredentials): Promise<RepostResult> {
    throw new PostError(PostErrorType.INVALID_CONTENT, "This platform does not support reposting through SimplePost");
  }

  /**
   * Platforms without native quote support intentionally fall back to an
   * ordinary post. This lets one multi-platform quote request preserve native
   * quotes where available without failing the remaining destinations.
   */
  protected async quoteContent(
    content: Content,
    _target: QuoteTarget,
    options?: PostOptionsWithCredentials,
  ): Promise<QuoteResult> {
    return this.postContent(content, options);
  }

  protected strictCheck(condition: boolean | undefined, message: string): asserts condition {
    if (condition) {
      if (this.strictMode) {
        throw new PostError(PostErrorType.INVALID_CONTENT, message);
      } else {
        this.logger.warn(message);
      }
    }
  }

  private withKnownLocalMediaSizes(content: Content): Content {
    if (!content.media) return content;

    return {
      ...content,
      media: content.media.map((item) => {
        // Once media has been prepared to a local path, prefer the actual
        // file size over caller metadata. Some URL-based callers use 0 to
        // mean "unknown", and supplied metadata can also become stale.
        if (!item.path) return item;
        try {
          return { ...item, size: fs.statSync(item.path).size };
        } catch {
          // Publishers retain their existing, platform-specific missing-file errors.
          return item;
        }
      }),
    };
  }

  /** Read-only eligibility checks: no media container or post is created. */
  async validateReadiness(content: Content, options?: PostOptions): Promise<ValidationIssue[]> {
    if (!this.platform) return [];
    try {
      return await checkAccountReadiness(this.platform, content, options ?? this.initialOptions);
    } catch (error) {
      return [readinessFailure(this.platform, error)];
    }
  }

  private async validateBeforeSend(
    content: Content,
    options?: PostOptionsWithCredentials,
    cache?: MediaInspectionCache,
  ): Promise<void> {
    if (!this.platform) return;
    const issues = await validatePostMedia({ platforms: [this.platform], content, options }, cache);
    if (!issues.some((issue) => issue.severity === "error"))
      issues.push(...(await this.validateReadiness(content, options)));
    const errors = issues.filter((issue) => issue.severity === "error");
    for (const warning of issues.filter((issue) => issue.severity === "warning")) this.logger.warn(warning.message);
    if (errors.length > 0)
      throw new PostError(PostErrorType.INVALID_CONTENT, errors.map((issue) => issue.message).join(" "), errors);
  }

  async post(
    content: Content,
    options?: PostOptionsWithCredentials,
    cache?: MediaInspectionCache,
  ): Promise<PostResult> {
    try {
      // Try to post the content
      this.logger.info(`Posting content...`);

      options = (options ?? this.initialOptions) as PostOptionsWithCredentials | undefined;
      await this.validateBeforeSend(content, options, cache);
      const result = await this.postContent(this.withKnownLocalMediaSizes(content), options);

      if (result.error === PostErrorType.NO_ERROR) {
        this.logger.info(`Post successful: ${result.id}`);
      } else {
        this.logger.info(`Post failed: ${result.error} - ${result.message}`);
      }

      return result;
    } catch (error: unknown) {
      // Handle PostErrors and generic errors

      const message = error instanceof Error ? error.message : "Unknown error";
      const data =
        typeof error === "object" && error && "data" in error ? (error as { data?: unknown }).data : undefined;

      this.logger.info(`Post failed: ${message}`);

      if (error instanceof PostError) {
        return { error: error.errorType, message: error.message, details: error.details };
      } else {
        this.logger.error(error instanceof Error ? error : message);
        return { error: PostErrorType.OTHER, message: `Error posting: ${message}`, details: data };
      }
    }
  }

  async repost(target: RepostTarget, options?: PostOptionsWithCredentials): Promise<RepostResult> {
    try {
      this.logger.info(`Reposting content...`);

      const result = await this.repostContent(target, options);

      if (result.error === PostErrorType.NO_ERROR) {
        this.logger.info(`Repost successful: ${result.id}`);
      } else {
        this.logger.info(`Repost failed: ${result.error} - ${result.message}`);
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const data =
        typeof error === "object" && error && "data" in error ? (error as { data?: unknown }).data : undefined;

      this.logger.info(`Repost failed: ${message}`);

      if (error instanceof PostError) {
        return { error: error.errorType, message: error.message, details: error.details };
      } else {
        this.logger.error(error instanceof Error ? error : message);
        return { error: PostErrorType.OTHER, message: `Error reposting: ${message}`, details: data };
      }
    }
  }

  async quote(
    content: Content,
    target: QuoteTarget,
    options?: PostOptionsWithCredentials,
    cache?: MediaInspectionCache,
  ): Promise<QuoteResult> {
    try {
      this.logger.info(`Quoting content...`);

      options = (options ?? this.initialOptions) as PostOptionsWithCredentials | undefined;
      await this.validateBeforeSend(content, options, cache);
      const result = await this.quoteContent(this.withKnownLocalMediaSizes(content), target, options);

      if (result.error === PostErrorType.NO_ERROR) {
        this.logger.info(`Quote successful: ${result.id}`);
      } else {
        this.logger.info(`Quote failed: ${result.error} - ${result.message}`);
      }

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const data =
        typeof error === "object" && error && "data" in error ? (error as { data?: unknown }).data : undefined;

      this.logger.info(`Quote failed: ${message}`);

      if (error instanceof PostError) {
        return { error: error.errorType, message: error.message, details: error.details };
      } else {
        this.logger.error(error instanceof Error ? error : message);
        return { error: PostErrorType.OTHER, message: `Error quoting: ${message}`, details: data };
      }
    }
  }
}
