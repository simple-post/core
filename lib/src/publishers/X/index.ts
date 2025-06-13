import { Content } from "../../types/post";
import { Publisher } from "../../types/publisher";
import { TwitterApi, TwitterApiTokens, TwitterApiv1 } from "twitter-api-v2";

export class XPublisher implements Publisher {
  private client: TwitterApi;
  private clientV1: TwitterApiv1;

  constructor() {
    this.client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    } as TwitterApiTokens);

    this.clientV1 = this.client.v1;
  }

  async post(content: Content) {
    await this.client.v2.tweet({
      text: content.text,
    });
  }
}
