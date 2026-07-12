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

  it("prefers id_string over the numeric id", async () => {
    // Real Tumblr ids exceed Number.MAX_SAFE_INTEGER; id_string carries the exact value.
    mockedAxios.post.mockResolvedValueOnce({
      data: { response: { id: 123, id_string: "123456789" } },
    });
    const publisher = new TumblrPublisher(options);

    const result = await publisher.postContent({ text: "Hello" }, options);

    expect(result.id).toBe("123456789");
    expect(result.url).toBe("https://www.tumblr.com/simplepost/123456789");
  });

  it("refreshes rotated tokens on 401 and reports them in refreshedCredentials", async () => {
    const optionsWithRefresh: PostOptionsWithCredentials = {
      tumblr: {
        blogIdentifier: "simplepost",
        credentials: {
          accessToken: "expired",
          refreshToken: "refresh-1",
          clientId: "client",
          clientSecret: "secret",
        },
      },
    };
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (payload: { isAxiosError?: boolean }) => payload?.isAxiosError === true,
    );
    mockedAxios.post
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } })
      .mockResolvedValueOnce({
        data: { access_token: "fresh", refresh_token: "refresh-2", expires_in: 3600 },
      })
      .mockResolvedValueOnce({ data: { response: { id_string: "456" } } });
    const publisher = new TumblrPublisher(optionsWithRefresh);

    const result = await publisher.postContent({ text: "Hello" }, optionsWithRefresh);

    expect(result.id).toBe("456");
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://api.tumblr.com/v2/oauth2/token",
      expect.any(URLSearchParams),
      expect.anything(),
    );
    expect(mockedAxios.post.mock.calls[2][2]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer fresh" }),
    });
    expect(result.extraData?.refreshedCredentials).toMatchObject({
      accessToken: "fresh",
      refreshToken: "refresh-2",
      expiresAt: expect.any(Number),
    });
  });
});
