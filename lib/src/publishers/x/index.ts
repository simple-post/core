import fs from "node:fs";

import { TwitterApi } from "twitter-api-v2";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";

const MAX_MEDIA_COUNT = 4;

export class XPublisher extends Publisher {
  private client: TwitterApi;
  private clientV1: TwitterApiv1;

  constructor(options?: PostOptionsWithCredentials) {
    super("X", options);

    // Validate the credentials
    if (!options?.x?.credentials) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are required in options.x.credentials");
    }

    const { apiKey, apiSecret, accessToken, accessSecret } = options.x.credentials;

    this.client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessSecret,
    } as TwitterApiTokens);

    this.clientV1 = this.client.v1;
  }

  private async uploadMedia(media: Media): Promise<string> {
    // Check if the media file exists
    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${media.path}`);
    }

    // Upload the media using the Twitter V1 API
    try {
      const mediaId = await this.clientV1.uploadMedia(media.path);

      this.logger.info(`Media uploaded: ${mediaId}`);

      return mediaId;
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(PostErrorType.API_ERROR, `Failed to upload media: ${error}`, error.data);
    }
  }

  private validate(content: Content): asserts content is (Content & { text: string }) | (Content & { media: Media[] }) {
    if (!content.text && (!content.media || content.media.length === 0))
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported");

    this.strictCheck(
      content.media && content.media.length > MAX_MEDIA_COUNT,
      `X supports up to ${MAX_MEDIA_COUNT} media files, only the first ${MAX_MEDIA_COUNT} will be uploaded`,
    );
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const replyToId = options?.x?.replyToId;

    // Validate the content
    this.validate(content);

    // Upload all media files if any
    const mediaIds: string[] = [];
    if (content.media) {
      for (const media of content.media.slice(0, MAX_MEDIA_COUNT)) {
        const mediaId = await this.uploadMedia(media);
        mediaIds.push(mediaId);
      }
    }

    // Post the tweet
    try {
      const { data: createdTweet } = await this.client.v2.tweet(content.text || "", {
        media: mediaIds.length > 0 ? { media_ids: mediaIds as [string, string, string, string] } : undefined,
        reply: replyToId ? { in_reply_to_tweet_id: replyToId } : undefined,
      });

      return { id: createdTweet.id, error: PostErrorType.NO_ERROR };
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Failed to post content: ${error}`, error.data);
    }
  }
}
