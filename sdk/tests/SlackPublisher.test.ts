import axios from "axios";

import { SlackPublisher } from "../src/publishers/slack";
import { PostError, PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SlackPublisher", () => {
  const options: PostOptionsWithCredentials = {
    slack: { channelId: "C123", credentials: { accessToken: "xoxb-token", teamId: "T123" } },
  };

  beforeEach(() => jest.clearAllMocks());

  it("requires credentials", () => {
    expect(() => new SlackPublisher()).toThrow(PostError);
  });

  it("posts a text message", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { ok: true, channel: "C123", ts: "1712345678.123456" } });
    const result = await new SlackPublisher(options).postContent({ text: "Hello Slack" }, options);

    expect(result).toEqual(expect.objectContaining({ id: "1712345678.123456", error: PostErrorType.NO_ERROR }));
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({ channel: "C123", text: "Hello Slack" }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer xoxb-token" }) }),
    );
  });

  it("surfaces Slack Web API errors returned with HTTP 200", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { ok: false, error: "channel_not_found" } });
    await expect(new SlackPublisher(options).postContent({ text: "Hello" }, options)).rejects.toThrow(
      "channel_not_found",
    );
  });

  it("uploads media with Slack's external upload flow", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { ok: true, upload_url: "https://files.slack.com/upload/test", file_id: "F123" } })
      .mockResolvedValueOnce({ data: "ok" })
      .mockResolvedValueOnce({ data: { ok: true, files: [{ id: "F123" }] } });

    const result = await new SlackPublisher(options).postContent(
      {
        text: "Attached",
        media: [{ type: "image", path: expect.getState().testPath!, caption: "Test attachment" }],
      },
      options,
    );

    expect(result.id).toBe("F123");
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      1,
      "https://slack.com/api/files.getUploadURLExternal",
      expect.objectContaining({ alt_txt: "Test attachment", filename: "SlackPublisher.test.ts" }),
      expect.any(Object),
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      3,
      "https://slack.com/api/files.completeUploadExternal",
      expect.objectContaining({
        channel_id: "C123",
        initial_comment: "Attached",
        files: [{ id: "F123", title: "SlackPublisher.test.ts" }],
      }),
      expect.any(Object),
    );
  });

  it("refreshes an expiring rotated Slack token", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: { ok: true, access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 },
      })
      .mockResolvedValueOnce({ data: { ok: true, channel: "C123", ts: "1712345678.123456" } });
    const rotatingOptions: PostOptionsWithCredentials = {
      slack: {
        channelId: "C123",
        credentials: {
          accessToken: "old-token",
          refreshToken: "old-refresh",
          clientId: "client-id",
          clientSecret: "client-secret",
          expiresAt: 1,
        },
      },
    };

    const result = await new SlackPublisher(rotatingOptions).postContent({ text: "Hello" }, rotatingOptions);
    expect(result.extraData?.refreshedCredentials).toEqual(
      expect.objectContaining({ accessToken: "new-token", refreshToken: "new-refresh" }),
    );
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://slack.com/api/chat.postMessage",
      expect.any(Object),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer new-token" }) }),
    );
  });

  it("requires a channel ID", async () => {
    await expect(
      new SlackPublisher(options).postContent(
        { text: "Hello" },
        { slack: { channelId: "", credentials: { accessToken: "token" } } },
      ),
    ).rejects.toThrow("channelId");
  });
});
