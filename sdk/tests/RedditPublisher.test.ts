import axios from "axios";

import { RedditPublisher } from "../src/publishers/reddit";
import { PostError, PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue("https://cdn.example.com/image.jpg"),
    deleteFile: jest.fn().mockResolvedValue(),
  })),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("RedditPublisher", () => {
  let client: { post: jest.Mock };
  let options: PostOptionsWithCredentials;

  beforeEach(() => {
    jest.clearAllMocks();
    client = { post: jest.fn() };
    mockedAxios.create.mockReturnValue(client as any);
    options = {
      reddit: {
        subreddit: "simplepost",
        title: "Hello Reddit",
        credentials: { accessToken: "token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
      },
    };
  });

  it("requires credentials", () => {
    expect(() => new RedditPublisher()).toThrow(PostError);
  });

  it("submits a text post", async () => {
    client.post.mockResolvedValue({
      data: { json: { errors: [], data: { id: "abc123", url: "https://reddit.com/r/simplepost/comments/abc123" } } },
    });
    const publisher = new RedditPublisher(options);
    const result = await publisher.postContent({ text: "Body text" }, options);

    expect(result).toEqual({
      id: "abc123",
      url: "https://reddit.com/r/simplepost/comments/abc123",
      error: PostErrorType.NO_ERROR,
    });
    const body = client.post.mock.calls[0][1] as URLSearchParams;
    expect(body.get("kind")).toBe("self");
    expect(body.get("sr")).toBe("simplepost");
    expect(body.get("text")).toBe("Body text");
  });

  it("submits a single image URL", async () => {
    client.post.mockResolvedValue({ data: { json: { errors: [], data: { name: "t3_image1" } } } });
    const publisher = new RedditPublisher(options);
    const result = await publisher.postContent(
      { media: [{ type: "image", url: "https://example.com/image.jpg" }] },
      options,
    );
    const body = client.post.mock.calls[0][1] as URLSearchParams;
    expect(body.get("kind")).toBe("image");
    expect(body.get("url")).toBe("https://example.com/image.jpg");
    expect(result.id).toBe("image1");
  });

  it("surfaces Reddit validation errors", async () => {
    client.post.mockResolvedValue({ data: { json: { errors: [["SUBREDDIT_NOTALLOWED", "Not allowed", "sr"]] } } });
    const publisher = new RedditPublisher(options);
    await expect(publisher.postContent({ text: "Body" }, options)).rejects.toThrow("Reddit rejected the post");
  });

  it("rejects video posts", async () => {
    const publisher = new RedditPublisher(options);
    await expect(
      publisher.postContent({ media: [{ type: "video", url: "https://example.com/video.mp4" }] }, options),
    ).rejects.toThrow(PostError);
  });
});
