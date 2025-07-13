import fs from "fs";
import { Content, Media, PostOptions } from "../../types/post";
import { Publisher } from "../base";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";
import { PostError, PostErrorType, PostResult } from "../../types";

export class XPublisher extends Publisher {
  private client: TwitterApi;
  private clientV1: TwitterApiv1;

  constructor(options?: PostOptions) {
    super("X", options);

    const clientId = process.env.TWITTER_API_KEY;
    const clientSecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!clientId || !clientSecret || !accessToken || !accessSecret) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET environment variables are required",
      );
    }

    this.client = new TwitterApi({
      appKey: clientId,
      appSecret: clientSecret,
      accessToken: accessToken,
      accessSecret: accessSecret,
    } as TwitterApiTokens);

    this.clientV1 = this.client.v1;
  }

  async uploadMedia(media: Media): Promise<string> {
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
      throw new PostError(PostErrorType.API_ERROR, `Error uploading media: ${error}`, error.data);
    }
  }

  validate(content: Content): asserts content is (Content & { text: string }) | (Content & { media: Media[] }) {
    if (!content.text && (!content.media || content.media.length === 0))
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported");

    this.strictCheck(
      content.media && content.media.length > 4,
      "X supports up to 4 media files, only the first 4 will be uploaded",
    );
  }

  async postContent(content: Content, options?: PostOptions): Promise<PostResult> {
    const replyToId = options?.x?.replyToId;

    // Validate the content
    this.validate(content);

    // Upload all media files if any
    let mediaIds: string[] = [];
    if (content.media) {
      for (const media of content.media.slice(0, 4)) {
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
      throw new PostError(PostErrorType.API_ERROR, `Error posting: ${error}`, error.data);
    }
  }
}
