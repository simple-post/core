import { quote } from "../src";
import { getPublisher } from "../src/publishers";
import { PostErrorType } from "../src/types";

jest.mock("../src/publishers", () => ({
  getPublisher: jest.fn(),
}));

const getPublisherMock = getPublisher as jest.Mock;

describe("quote", () => {
  it("uses platform-specific targets and posts normally when a target is absent", async () => {
    const publishers = {
      x: { quote: jest.fn().mockResolvedValue({ id: "x-quote", error: PostErrorType.NO_ERROR }), post: jest.fn() },
      bluesky: {
        quote: jest.fn().mockResolvedValue({ id: "bsky-quote", error: PostErrorType.NO_ERROR }),
        post: jest.fn(),
      },
      instagram: {
        quote: jest.fn(),
        post: jest.fn().mockResolvedValue({ id: "ig-post", error: PostErrorType.NO_ERROR }),
      },
    };
    getPublisherMock.mockImplementation((platform: keyof typeof publishers) => publishers[platform]);

    const results = await quote({
      content: { text: "A platform-aware quote" },
      platforms: ["x", "bluesky", "instagram"],
      targets: {
        x: { postId: "x-source" },
        bluesky: { postId: "bsky-source", uri: "at://source", cid: "source-cid" },
      },
    });

    expect(publishers.x.quote).toHaveBeenCalledWith(
      { text: "A platform-aware quote" },
      { postId: "x-source" },
      expect.any(Object),
    );
    expect(publishers.bluesky.quote).toHaveBeenCalledWith(
      { text: "A platform-aware quote" },
      { postId: "bsky-source", uri: "at://source", cid: "source-cid" },
      expect.any(Object),
    );
    expect(publishers.instagram.post).toHaveBeenCalledWith({ text: "A platform-aware quote" }, expect.any(Object));
    expect(results.get("instagram")).toMatchObject({ id: "ig-post", error: PostErrorType.NO_ERROR });
  });
});
