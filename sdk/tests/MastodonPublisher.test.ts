import fs from "node:fs";
import { Readable } from "node:stream";

import axios from "axios";

import { MastodonPublisher } from "../src/publishers/mastodon";
import { PostError, PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
jest.mock("fs");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("MastodonPublisher", () => {
  let client: { get: jest.Mock; post: jest.Mock };
  let options: PostOptionsWithCredentials;

  beforeEach(() => {
    jest.clearAllMocks();
    client = { get: jest.fn(), post: jest.fn() };
    mockedAxios.create.mockReturnValue(client as any);
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.createReadStream.mockReturnValue(Readable.from(Buffer.from("image")) as fs.ReadStream);
    options = {
      mastodon: {
        visibility: "unlisted",
        credentials: { instanceUrl: "https://mastodon.example", accessToken: "token" },
      },
    };
  });

  it("requires credentials", () => {
    expect(() => new MastodonPublisher()).toThrow(PostError);
  });

  it("publishes a text status", async () => {
    client.post.mockResolvedValue({ data: { id: "status-1", url: "https://mastodon.example/@me/1" } });
    const publisher = new MastodonPublisher(options);
    const result = await publisher.postContent({ text: "Hello fediverse" }, options);

    expect(result).toEqual({
      id: "status-1",
      url: "https://mastodon.example/@me/1",
      error: PostErrorType.NO_ERROR,
    });
    expect(client.post).toHaveBeenCalledWith(
      "/api/v1/statuses",
      expect.objectContaining({ status: "Hello fediverse", visibility: "unlisted" }),
      expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }) }),
    );
  });

  it("uploads media before publishing", async () => {
    client.post
      .mockResolvedValueOnce({ data: { id: "media-1", url: "https://mastodon.example/media/1" } })
      .mockResolvedValueOnce({ data: { id: "status-2" } });
    const publisher = new MastodonPublisher(options);
    const result = await publisher.postContent(
      { text: "Photo", media: [{ type: "image", path: "/tmp/photo.jpg", caption: "A photo" }] },
      options,
    );

    expect(client.post.mock.calls[0][0]).toBe("/api/v2/media");
    expect(client.post.mock.calls[1][1]).toEqual(expect.objectContaining({ media_ids: ["media-1"] }));
    expect(result.id).toBe("status-2");
  });

  it("boosts an existing status", async () => {
    client.post.mockResolvedValue({ data: { id: "boost-1", url: "https://mastodon.example/@me/boost-1" } });
    const publisher = new MastodonPublisher(options);
    const result = await publisher.repost({ postId: "source-1" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/statuses/source-1/reblog");
    expect(result.error).toBe(PostErrorType.NO_ERROR);
  });

  it("rejects more than four media attachments", async () => {
    const publisher = new MastodonPublisher(options);
    await expect(
      publisher.postContent(
        {
          media: Array.from({ length: 5 }, (_, index) => ({
            type: "image" as const,
            url: `https://example.com/${index}.jpg`,
          })),
        },
        options,
      ),
    ).rejects.toThrow(PostError);
  });
});
