import { post, quote, repost } from "../src";
import { getPublisher } from "../src/publishers";
import { PostError, PostErrorType } from "../src/types";

import type { Platform } from "../src/types/post";

jest.mock("../src/publishers", () => ({ getPublisher: jest.fn() }));

const getPublisherMock = jest.mocked(getPublisher);
const platforms: Platform[] = ["telegram", "x", "bluesky"];
const operations = {
  post: () => post({ platforms, content: { text: "hello" } }),
  repost: () => repost({ platforms, target: { postId: "source" } }),
  quote: () => quote({ platforms, content: { text: "hello" }, target: { postId: "source" } }),
  quoteFallback: () => quote({ platforms, content: { text: "hello" } }),
};

describe.each(Object.entries(operations))("%s failure isolation", (_name, publish) => {
  it.each(["constructor", "request"])(
    "keeps earlier results and attempts later platforms after a %s failure",
    async (stage) => {
      const calls: Platform[] = [];
      const failure = new PostError(PostErrorType.CREDENTIALS_ERROR, "X credentials are missing", { platform: "x" });
      getPublisherMock.mockImplementation((platform) => {
        calls.push(platform);
        if (platform === "x" && stage === "constructor") throw failure;
        const result = async () => {
          if (platform === "x") throw failure;
          return { id: `${platform}-published`, error: PostErrorType.NO_ERROR };
        };
        return { post: result, repost: result, quote: result } as unknown as ReturnType<typeof getPublisher>;
      });

      const results = await publish();

      expect(calls).toEqual(platforms);
      expect(results.size).toBe(3);
      expect(results.get("telegram")).toEqual({ id: "telegram-published", error: PostErrorType.NO_ERROR });
      expect(results.get("x")).toEqual({
        error: PostErrorType.CREDENTIALS_ERROR,
        message: "X credentials are missing",
        details: { platform: "x" },
      });
      expect(results.get("bluesky")).toEqual({ id: "bluesky-published", error: PostErrorType.NO_ERROR });
    },
  );

  it("normalizes unexpected constructor errors", async () => {
    getPublisherMock.mockImplementation(() => {
      throw new Error("Client initialization failed");
    });
    const results = await publish();
    expect([...results.values()]).toEqual(
      platforms.map(() => ({
        error: PostErrorType.OTHER,
        message: "Client initialization failed",
      })),
    );
  });
});
