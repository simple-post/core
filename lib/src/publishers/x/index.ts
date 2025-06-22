import { Content, Media } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";
import { PostErrorType, PostResult } from "../../types";

export class XPublisher extends Publisher {
  private client: TwitterApi;
  private clientV1: TwitterApiv1;

  constructor() {
    super();

    this.client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    } as TwitterApiTokens);

    this.clientV1 = this.client.v1;
  }

  async uploadMedia(media: Media) {
    // TODO: Add support for video and image URLs
    if (!media.path) throw new Error("Media path is required");

    try {
      return await this.clientV1.uploadMedia(media.path);
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Error uploading media: ${error}`, error.data);
    }
  }

  async postTweet(content: Content, replyTo?: string): Promise<string> {
    // Upload the media
    let mediaIds: string[] = [];

    // Check for empty tweet
    if (!content.text && !content.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by X");
    }

    // Upload media
    if (content.media) {
      // Upload each media element
      for (const media of content.media.slice(0, 4)) {
        const mediaId = await this.uploadMedia(media);
        mediaIds.push(mediaId);
      }
    }

    // Post the tweet
    try {
      const { data: createdTweet } = await this.client.v2.tweet(content.text || "", {
        media: mediaIds.length > 0 ? { media_ids: mediaIds as [string, string, string, string] } : undefined,
        reply: replyTo ? { in_reply_to_tweet_id: replyTo } : undefined,
      });

      return createdTweet.id;
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Error posting: ${error}`, error.data);
    }
  }

  async post(content: Content[]): Promise<PostResult[]> {
    const results: PostResult[] = [];
    let lastTweetId: string | undefined = undefined;

    for (const item of content) {
      try {
        const tweetId = await this.postTweet(item, lastTweetId);
        lastTweetId = tweetId;

        results.push({
          id: tweetId,
          error: PostErrorType.NO_ERROR,
        });
      } catch (error: any) {
        if (error instanceof PostError) {
          results.push({
            error: error.errorType,
            message: error.message,
            details: error.details,
          });
        } else {
          results.push({
            error: PostErrorType.OTHER,
            message: `Error posting: ${error.message}`,
            details: error,
          });
        }
      }
    }

    return results;
  }
}
