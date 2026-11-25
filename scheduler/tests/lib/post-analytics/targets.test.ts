import { analyticsSeedsForPost, analyticsTargetFor } from "@/lib/post-analytics/targets";

const post = {
  id: "post",
  userId: "user",
  status: "failed",
  publishedAt: null,
  updatedAt: new Date("2026-11-20T10:00:00Z"),
  accounts: [
    { id: "a", platform: "twitter" },
    { id: "b", platform: "bluesky" },
    { id: "c", platform: "threads" },
  ],
  accountResults: {
    a: { accountId: "a", platform: "twitter", success: true, postId: "111", completedAt: "2026-11-20T09:00:00Z" },
    b: {
      accountId: "b",
      platform: "bluesky",
      success: true,
      postId: "at://did/app.bsky.feed.post/1",
      completedAt: "invalid",
      platformData: { uri: "at://did/app.bsky.feed.post/1", cid: "cid" },
    },
    c: { accountId: "c", platform: "threads", success: false, completedAt: "2026-11-20T09:00:00Z" },
    removed: { accountId: "removed", platform: "x", success: true, postId: "9", completedAt: "2026-11-20T09:00:00Z" },
  },
};

describe("analytics targets", () => {
  it("seeds one row per successfully published, still-attached account", () => {
    expect(analyticsSeedsForPost(post)).toEqual([
      {
        postId: "post",
        userId: "user",
        accountId: "a",
        platform: "x",
        platformPostId: "111",
        publishedAt: new Date("2026-11-20T09:00:00Z"),
      },
      expect.objectContaining({ accountId: "b", platform: "bluesky", publishedAt: post.updatedAt }),
    ]);
  });

  it("passes publish hints to the SDK", () => {
    expect(
      analyticsTargetFor(
        { platformPostId: "at://did/app.bsky.feed.post/1", accountId: "b" },
        { accountResults: post.accountResults, media: [{ type: "video" }] },
      ),
    ).toEqual({
      postId: "at://did/app.bsky.feed.post/1",
      platformData: { uri: "at://did/app.bsky.feed.post/1", cid: "cid" },
      uri: "at://did/app.bsky.feed.post/1",
      mediaType: "video",
    });
    expect(
      analyticsTargetFor({ platformPostId: "1", accountId: "a" }, { accountResults: {}, media: [] }).mediaType,
    ).toBe("text");
  });
});
