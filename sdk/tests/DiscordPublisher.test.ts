import axios from "axios";

import { DiscordPublisher } from "../src/publishers/discord";
import { PostError, PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("DiscordPublisher", () => {
  const options: PostOptionsWithCredentials = {
    discord: { credentials: { webhookUrl: "https://discord.com/api/webhooks/123/token_abc" } },
  };

  beforeEach(() => jest.clearAllMocks());

  it("requires credentials", () => {
    expect(() => new DiscordPublisher()).toThrow(PostError);
  });

  it("rejects non-Discord webhook URLs", () => {
    expect(
      () => new DiscordPublisher({ discord: { credentials: { webhookUrl: "https://example.com/hook" } } }),
    ).toThrow(PostError);
  });

  it("reports malformed webhook URLs as credential errors", () => {
    expect(() => new DiscordPublisher({ discord: { credentials: { webhookUrl: "not-a-url" } } })).toThrow(PostError);
  });

  it("posts a text message with mentions disabled by default", async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: "message-1", channel_id: "channel-1", guild_id: "guild-1" } });
    const publisher = new DiscordPublisher(options);
    const result = await publisher.postContent({ text: "Hello Discord" }, options);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token_abc?wait=true",
      expect.objectContaining({ content: "Hello Discord", allowed_mentions: { parse: [] } }),
      expect.anything(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "message-1",
        url: "https://discord.com/channels/guild-1/channel-1/message-1",
        error: PostErrorType.NO_ERROR,
      }),
    );
  });

  it("adds a thread target and message flags", async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: "message-2" } });
    const configured: PostOptionsWithCredentials = {
      discord: { ...options.discord!, threadId: "thread-1", suppressEmbeds: true, suppressNotifications: true },
    };
    const publisher = new DiscordPublisher(configured);
    await publisher.postContent({ text: "Quiet update" }, configured);
    expect(mockedAxios.post.mock.calls[0][0]).toContain("thread_id=thread-1");
    expect(mockedAxios.post.mock.calls[0][1]).toEqual(expect.objectContaining({ flags: 4100 }));
  });

  it("rejects messages over 2000 characters", async () => {
    const publisher = new DiscordPublisher(options);
    await expect(publisher.postContent({ text: "x".repeat(2001) }, options)).rejects.toThrow(PostError);
  });
});
