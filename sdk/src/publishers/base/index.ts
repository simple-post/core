import { PostError, PostErrorType } from "../../types";
import { Logger } from "../../utils/logger";

import type { PostResult } from "../../types";
import type { Content, PostOptions, PostOptionsWithCredentials } from "../../types/post";

export type MediaRequirement = "path" | "url" | "either";

export abstract class Publisher {
  readonly logger: Logger;
  readonly strictMode: boolean;

  /**
   * Static property defining the media requirement for this publisher
   * - "path": Platform requires a local file path (downloads URLs)
   * - "url": Platform requires a public URL (uploads paths to S3/public storage)
   * - "either": Platform accepts both, but may prefer one
   */
  static readonly mediaRequirement: MediaRequirement;

  constructor(name: string, options?: PostOptions) {
    this.logger = new Logger(name, options?.common?.logLevel);
    this.strictMode = options?.common?.strictMode ?? false;
  }

  protected abstract postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult>;

  protected strictCheck(condition: boolean | undefined, message: string): asserts condition {
    if (condition) {
      if (this.strictMode) {
        throw new PostError(PostErrorType.INVALID_CONTENT, message);
      } else {
        this.logger.warn(message);
      }
    }
  }

  async post(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    try {
      // Try to post the content
      this.logger.info(`Posting content...`);

      const result = await this.postContent(content, options);

      if (result.error === PostErrorType.NO_ERROR) {
        this.logger.info(`Post successful: ${result.id}`);
      } else {
        this.logger.info(`Post failed: ${result.error} - ${result.message}`);
      }

      return result;
    } catch (error: any) {
      // Handle PostErrors and generic errors

      this.logger.info(`Post failed: ${error.message}`);

      if (error instanceof PostError) {
        return { error: error.errorType, message: error.message, details: error.details };
      } else {
        this.logger.error(error);
        return { error: PostErrorType.OTHER, message: `Error posting: ${error.message}`, details: error.data };
      }
    }
  }
}
