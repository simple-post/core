import fs from "node:fs";

import { getAnalyticsCapability } from "../../analytics";
import { PostError, PostErrorType } from "../../types";
import { checkAccountReadiness, readinessFailure } from "../../utils/account-readiness";
import {
  AnalyticsError,
  chunk,
  classifyAnalyticsError,
  mapWithConcurrency,
  postAnalyticsResult,
} from "../../utils/analytics";
import { Logger } from "../../utils/logger";
import { getMetaCredentialRejection, isMetaCredentialPlatform } from "../../utils/meta-credential-rejection";
import { validatePostMedia, type MediaInspectionCache } from "../../utils/post-media-validation";

import type {
  AccountAnalytics,
  AccountAnalyticsResponse,
  AnalyticsTarget,
  PostAnalytics,
  PostAnalyticsResponse,
  RefreshedAnalyticsCredentials,
} from "../../analytics";
import type { PostResult, QuoteResult, RepostResult } from "../../types";
import type { PlacementResult } from "../../types/api";
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

/** Parallel provider requests per analytics call; keeps per-post APIs well below rate limits. */
const ANALYTICS_CONCURRENCY = 3;

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

  /** Allowlisted Meta revocation evidence only; raw provider errors can contain request credentials. */
  private credentialRejectionIssue(error: unknown): ValidationIssue | undefined {
    if (!isMetaCredentialPlatform(this.platform) || !getMetaCredentialRejection(error)) return undefined;
    return readinessFailure(this.platform, error);
  }

  /** Revoked sessions cannot be repaired by refreshing; retain the diagnosis without exposing request data. */
  protected throwIfCredentialRevoked(error: unknown): void {
    const issue = this.credentialRejectionIssue(error);
    if (issue) throw new PostError(PostErrorType.CREDENTIALS_ERROR, issue.message, [issue]);
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
    cache: MediaInspectionCache = new Map(),
  ): Promise<PostResult> {
    options = (options ?? this.initialOptions) as PostOptionsWithCredentials | undefined;
    const platform = this.platform;
    const settings = platform === "facebook" || platform === "instagram" ? options?.[platform] : undefined;
    const withPlacement = (result: PostResult): PostResult =>
      settings?.placement === "story"
        ? { ...result, placementResults: [this.toPlacementResult("story", result)] }
        : result;
    try {
      this.logger.info(`Posting content...`);

      await this.validateBeforeSend(content, options, cache);
      if (platform && settings?.placement === "both") {
        const regular = await this.post(content, { ...options, [platform]: { ...settings, placement: "post" } }, cache);
        const story = await this.post(content, { ...options, [platform]: { ...settings, placement: "story" } }, cache);
        const placementResults = [this.toPlacementResult("post", regular), this.toPlacementResult("story", story)];
        const failure = regular.error === PostErrorType.NO_ERROR ? story : regular;
        return {
          ...regular,
          error: failure.error,
          message: failure.message,
          details: failure.details,
          extraData: story.extraData ?? regular.extraData,
          placementResults,
        };
      }
      const result = await this.postContent(this.withKnownLocalMediaSizes(content), options);

      if (result.error === PostErrorType.NO_ERROR) {
        this.logger.info(`Post successful: ${result.id}`);
      } else {
        this.logger.info(`Post failed: ${result.error} - ${result.message}`);
      }

      return withPlacement(result);
    } catch (error: unknown) {
      // Handle PostErrors and generic errors
      const issue = this.credentialRejectionIssue(error);
      if (issue)
        return withPlacement({ error: PostErrorType.CREDENTIALS_ERROR, message: issue.message, details: [issue] });

      const message = error instanceof Error ? error.message : "Unknown error";
      const data =
        typeof error === "object" && error && "data" in error ? (error as { data?: unknown }).data : undefined;

      this.logger.info(`Post failed: ${message}`);

      if (error instanceof PostError) {
        return withPlacement({ error: error.errorType, message: error.message, details: error.details });
      } else {
        this.logger.error(error instanceof Error ? error : message);
        return withPlacement({ error: PostErrorType.OTHER, message: `Error posting: ${message}`, details: data });
      }
    }
  }

  private toPlacementResult(placement: PlacementResult["placement"], result: PostResult): PlacementResult {
    const success = result.error === PostErrorType.NO_ERROR;
    return {
      placement,
      success,
      postId: result.id,
      postUrl: result.url,
      error: success ? undefined : result.error,
      message: result.message,
    };
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
      const issue = this.credentialRejectionIssue(error);
      if (issue) return { error: PostErrorType.CREDENTIALS_ERROR, message: issue.message, details: [issue] };

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

      if (this.platform === "facebook" || this.platform === "instagram") {
        const placement = (options ?? this.initialOptions)?.[this.platform]?.placement;
        if (placement === "story" || placement === "both")
          throw new PostError(PostErrorType.INVALID_CONTENT, "Stories cannot quote existing posts.");
      }

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
      const issue = this.credentialRejectionIssue(error);
      if (issue) return { error: PostErrorType.CREDENTIALS_ERROR, message: issue.message, details: [issue] };

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

  /**
   * Reads analytics for posts the connected account published. Override
   * `fetchPostAnalytics` to support a platform. Never throws: every target
   * gets a result with a status, and a failing batch does not affect others.
   */
  async getPostAnalytics(
    targets: AnalyticsTarget[],
    options?: PostOptionsWithCredentials,
  ): Promise<PostAnalyticsResponse> {
    const platform = this.requirePlatform();
    const capability = getAnalyticsCapability(platform);
    options = (options ?? this.initialOptions) as PostOptionsWithCredentials | undefined;

    if (!capability.posts) {
      return {
        platform,
        results: targets.map((target) =>
          postAnalyticsResult(platform, target.postId, "unsupported", { message: capability.notes[0] }),
        ),
      };
    }

    const batches = chunk(targets, capability.batchSize);
    const batchResults = await mapWithConcurrency(batches, ANALYTICS_CONCURRENCY, async (batch) => {
      try {
        const results = await this.fetchPostAnalytics(batch, options);
        // Guarantee one result per requested target, in request order.
        return batch.map(
          (target) =>
            results.find((result) => result.postId === target.postId) ??
            postAnalyticsResult(platform, target.postId, "not_found", {
              message: `${this.logger.name} did not return this post.`,
            }),
        );
      } catch (error) {
        const { status, message } = classifyAnalyticsError(error, this.logger.name);
        if (status === "error") this.logger.warn(`Analytics request failed: ${message}`);
        return batch.map((target) => postAnalyticsResult(platform, target.postId, status, { message }));
      }
    });

    const refreshedCredentials = this.getRefreshedAnalyticsCredentials();
    return { platform, results: batchResults.flat(), ...(refreshedCredentials ? { refreshedCredentials } : {}) };
  }

  /** Reads account-level analytics (followers, …). Never throws. */
  async getAccountAnalytics(options?: PostOptionsWithCredentials): Promise<AccountAnalyticsResponse> {
    const platform = this.requirePlatform();
    const capability = getAnalyticsCapability(platform);
    options = (options ?? this.initialOptions) as PostOptionsWithCredentials | undefined;
    let result: AccountAnalytics;

    if (capability.account) {
      try {
        result = await this.fetchAccountAnalytics(options);
      } catch (error) {
        const { status, message } = classifyAnalyticsError(error, this.logger.name);
        result = { platform, status, metrics: {}, message, fetchedAt: new Date().toISOString() };
      }
    } else {
      result = {
        platform,
        status: "unsupported",
        metrics: {},
        message: `${this.logger.name} does not provide account analytics.`,
        fetchedAt: new Date().toISOString(),
      };
    }

    const refreshedCredentials = this.getRefreshedAnalyticsCredentials();
    return { ...result, ...(refreshedCredentials ? { refreshedCredentials } : {}) };
  }

  /** Reads one batch (at most `batchSize` targets). May throw; errors apply to the whole batch. */
  protected async fetchPostAnalytics(
    _targets: AnalyticsTarget[],
    _options?: PostOptionsWithCredentials,
  ): Promise<PostAnalytics[]> {
    throw new AnalyticsError("unsupported", `${this.logger.name} does not provide post analytics.`);
  }

  protected async fetchAccountAnalytics(_options?: PostOptionsWithCredentials): Promise<AccountAnalytics> {
    throw new AnalyticsError("unsupported", `${this.logger.name} does not provide account analytics.`);
  }

  /** Publishers that refresh tokens themselves return the new credentials here so callers can persist them. */
  protected getRefreshedAnalyticsCredentials(): RefreshedAnalyticsCredentials | undefined {
    return undefined;
  }

  private requirePlatform(): Platform {
    if (!this.platform) throw new PostError(PostErrorType.OTHER, "Publisher platform is not configured.");
    return this.platform;
  }
}
