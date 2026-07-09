import { buildQuoteTargets, hasSuccessfulQuoteSourceResult } from "@/lib/quote/targets";

describe("quote target resolution", () => {
  const source = {
    accounts: [
      { id: "x-source", platform: "x" },
      { id: "x-second", platform: "twitter" },
      { id: "bsky-source", platform: "bluesky" },
      { id: "instagram-source", platform: "instagram" },
    ],
    accountResults: {
      "x-source": {
        accountId: "x-source",
        platform: "x",
        success: true,
        postId: "tweet-1",
        completedAt: "2026-07-09T10:00:00.000Z",
      },
      "x-second": {
        accountId: "x-second",
        platform: "twitter",
        success: true,
        postId: "tweet-2",
        completedAt: "2026-07-09T10:00:00.000Z",
      },
      "bsky-source": {
        accountId: "bsky-source",
        platform: "bluesky",
        success: true,
        postId: "at://did:plc:source/app.bsky.feed.post/one",
        completedAt: "2026-07-09T10:00:00.000Z",
        platformData: {
          uri: "at://did:plc:source/app.bsky.feed.post/one",
          cid: "bsky-cid",
        },
      },
      "instagram-source": {
        accountId: "instagram-source",
        platform: "instagram",
        success: true,
        postId: "ig-1",
        completedAt: "2026-07-09T10:00:00.000Z",
      },
    },
  };

  it("prefers the exact account and falls back to a source on the same platform", () => {
    expect(
      buildQuoteTargets(source, [
        { id: "x-second", platform: "x" },
        { id: "another-x", platform: "twitter" },
      ]),
    ).toEqual([
      expect.objectContaining({ accountId: "x-second", postId: "tweet-2" }),
      expect.objectContaining({ accountId: "another-x", postId: "tweet-1" }),
    ]);
  });

  it("carries Bluesky uri/cid and omits platforms without native quotes", () => {
    expect(
      buildQuoteTargets(source, [
        { id: "new-bsky", platform: "bluesky" },
        { id: "new-instagram", platform: "instagram" },
      ]),
    ).toEqual([
      {
        accountId: "new-bsky",
        postId: "at://did:plc:source/app.bsky.feed.post/one",
        postUrl: undefined,
        uri: "at://did:plc:source/app.bsky.feed.post/one",
        cid: "bsky-cid",
      },
    ]);
  });

  it("omits malformed or failed native targets so those destinations post normally", () => {
    const unavailable = {
      accounts: [
        { id: "x", platform: "x" },
        { id: "bsky", platform: "bluesky" },
      ],
      accountResults: {
        x: { accountId: "x", platform: "x", success: false, completedAt: "2026-07-09T10:00:00.000Z" },
        bsky: {
          accountId: "bsky",
          platform: "bluesky",
          success: true,
          postId: "at://missing-cid",
          completedAt: "2026-07-09T10:00:00.000Z",
        },
      },
    };

    expect(buildQuoteTargets(unavailable, unavailable.accounts)).toEqual([]);
    expect(hasSuccessfulQuoteSourceResult(unavailable)).toBe(true);
  });
});
