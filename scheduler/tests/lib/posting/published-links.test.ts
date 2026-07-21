import { getPublishedPostLinkGroups } from "@/lib/posting/published-links";
import type { ConnectedAccount } from "@/types";

const account = {
  id: "account-1",
  platform: "x",
  displayName: "Edmund Clompton",
  username: "clompton",
} as ConnectedAccount;

describe("getPublishedPostLinkGroups", () => {
  it("returns successful persisted post URLs", () => {
    const groups = getPublishedPostLinkGroups(
      {
        accountResults: {
          "account-1": {
            accountId: "account-1",
            platform: "x",
            success: true,
            postUrl: "https://x.com/clompton/status/1",
            completedAt: "2026-07-16T12:00:00.000Z",
          },
        },
      },
      [account],
    );

    expect(groups).toEqual([
      {
        accountId: "account-1",
        accountName: "Edmund Clompton",
        platform: "x",
        links: [{ label: "View post", url: "https://x.com/clompton/status/1" }],
      },
    ]);
  });

  it("shows every successful thread segment instead of duplicating the root URL", () => {
    const groups = getPublishedPostLinkGroups(
      {
        accountResults: {
          "account-1": {
            accountId: "account-1",
            platform: "x",
            success: true,
            postUrl: "https://x.com/clompton/status/1",
            completedAt: "2026-07-16T12:00:00.000Z",
          },
        },
        threadResults: {
          "account-1": [
            { index: 0, success: true, postUrl: "https://x.com/clompton/status/1" },
            { index: 1, success: true, postUrl: "https://x.com/clompton/status/2" },
            { index: 2, success: false, error: "Failed" },
          ],
        },
      },
      [account],
    );

    expect(groups[0].links).toEqual([
      { label: "Post 1", url: "https://x.com/clompton/status/1" },
      { label: "Post 2", url: "https://x.com/clompton/status/2" },
    ]);
  });

  it("omits failures and successful results that have no URL", () => {
    const groups = getPublishedPostLinkGroups(
      {
        accountResults: {
          failed: {
            accountId: "failed",
            platform: "youtube",
            success: false,
            completedAt: "2026-07-16T12:00:00.000Z",
          },
          telegram: {
            accountId: "telegram",
            platform: "telegram",
            success: true,
            postId: "15",
            completedAt: "2026-07-16T12:00:00.000Z",
          },
        },
      },
      [],
    );

    expect(groups).toEqual([]);
  });
});
