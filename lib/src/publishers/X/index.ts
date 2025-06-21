import { Content, Media } from "../../types/post";
import { Publisher } from "../../types/publisher";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";
import logger from "../../logger";
import { Logger } from "pino";

export class XPublisher extends Publisher {
  private client: TwitterApi;
  private clientV1: TwitterApiv1;
  private logger: Logger;

  constructor() {
    super();

    this.client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    } as TwitterApiTokens);

    this.clientV1 = this.client.v1;

    this.logger = logger.child({ module: "X" });
  }

  async uploadMedia(media: Media) {
    // TODO: Add support for video and image URLs
    if (!media.path) throw new Error("Media path is required");

    return await this.clientV1.uploadMedia(media.path);
  }

  async postTweet(content: Content, replyTo?: string) {
    // Upload the media
    let mediaIds: string[] = [];

    // Check for empty tweet
    if (!content.text && !content.media) {
      this.logger.error("Empty tweet is not supported by X");
      return;
    }

    // Upload media
    if (content.media) {
      // Check the number of media elements
      if (content.media.length > 4)
        this.logger.warn(
          "More than 4 media elements are not supported by X. Publishing only the first 4 media elements."
        );

      // Upload each media element
      for (const media of content.media.slice(0, 4)) {
        try {
          const mediaId = await this.uploadMedia(media);
          mediaIds.push(mediaId);

          this.logger.debug(`Media uploaded successfully! Media ID: ${mediaId}`);
        } catch (error) {
          this.logger.error(`Error uploading media ${media.path}: ${error}`);
        }
      }
    }

    // Post the tweet
    const { data: createdTweet } = await this.client.v2.tweet(content.text || "", {
      media: mediaIds.length > 0 ? { media_ids: mediaIds as [string, string, string, string] } : undefined,
      reply: replyTo ? { in_reply_to_tweet_id: replyTo } : undefined,
    });
    this.logger.info(`Tweet posted successfully! Tweet ID: ${createdTweet.id}`);

    return createdTweet.id;
  }

  async post(content: Content[]): Promise<string[]> {
    const results: string[] = [];
    let lastTweetId: string | undefined = undefined;

    try {
      for (const item of content) {
        const tweetId = await this.postTweet(item, lastTweetId);
        if (tweetId) {
          results.push(tweetId);
          lastTweetId = tweetId;
        }
      }
      return results;
    } catch (error) {
      this.logger.error(`Error posting tweets: ${error}`);
      throw error;
    }
  }
}
