import axios from "axios";

import { TumblrPublisher } from "../src/publishers/tumblr";
import { PostError, PostErrorType } from "../src/types";

import type { Content, PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("TumblrPublisher", () => {
  const options: PostOptionsWithCredentials = {
    tumblr: {
      blogIdentifier: "simplepost",
      credentials: { accessToken: "token" },
      state: "published",
      tags: ["simplepost", "release"],
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it("requires credentials", () => {
    expect(() => new TumblrPublisher()).toThrow(PostError);
  });

  it("publishes NPF text and image blocks", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: { id: "123" } } });
    const publisher = new TumblrPublisher(options);
    const content: Content = {
      text: "Hello Tumblr",
      media: [{ type: "image", url: "https://cdn.example.com/photo.jpg", caption: "Alt text" }],
    };
    const result = await publisher.postContent(content, options);

    expect(result).toEqual(expect.objectContaining({ id: "123", error: PostErrorType.NO_ERROR }));
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://api.tumblr.com/v2/blog/simplepost/posts",
      expect.objectContaining({
        content: [
          { type: "text", text: "Hello Tumblr" },
          expect.objectContaining({ type: "image", alt_text: "Alt text" }),
        ],
        state: "published",
        tags: "simplepost,release",
      }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }),
    );
  });

  it("requires a blog identifier", async () => {
    const publisher = new TumblrPublisher(options);
    await expect(
      publisher.postContent({ text: "Hello" }, { tumblr: { credentials: { accessToken: "token" } } } as never),
    ).rejects.toThrow("blogIdentifier");
  });
});
