import { google } from "googleapis";

import { YouTubePublisher } from "../src/publishers/youtube";

jest.mock("googleapis", () => ({
  google: { auth: { OAuth2: jest.fn() }, youtube: jest.fn(), youtubeAnalytics: jest.fn() },
}));

const mockedGoogle = google as jest.Mocked<typeof google>;

describe("YouTube analytics", () => {
  const videosList = jest.fn();
  const channelsList = jest.fn();
  const reportsQuery = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (mockedGoogle.auth.OAuth2 as unknown as jest.Mock).mockImplementation(() => ({ setCredentials: jest.fn() }));
    mockedGoogle.youtube.mockReturnValue({ videos: { list: videosList }, channels: { list: channelsList } } as never);
    mockedGoogle.youtubeAnalytics.mockReturnValue({ reports: { query: reportsQuery } } as never);
  });

  it("combines real-time statistics with Analytics API watch time", async () => {
    videosList.mockResolvedValue({
      data: {
        items: [
          {
            id: "abc",
            snippet: { publishedAt: "2026-11-01T00:00:00Z" },
            statistics: { viewCount: "1000", likeCount: "50", commentCount: "4" },
          },
        ],
      },
    });
    reportsQuery.mockResolvedValue({
      data: {
        columnHeaders: [
          { name: "video" },
          { name: "shares" },
          { name: "estimatedMinutesWatched" },
          { name: "averageViewDuration" },
          { name: "subscribersGained" },
        ],
        rows: [["abc", 3, 20, 45, 2]],
      },
    });

    const publisher = new YouTubePublisher({ youtube: { credentials: { accessToken: "token-a" } } });
    const { results } = await publisher.getPostAnalytics([{ postId: "abc" }, { postId: "gone" }]);

    expect(reportsQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: "channel==MINE",
        dimensions: "video",
        filters: "video==abc,gone",
        sort: "-views",
      }),
      expect.anything(),
    );
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: {
          views: 1000,
          likes: 50,
          comments: 4,
          shares: 3,
          watchTimeSeconds: 1200,
          averageWatchTimeSeconds: 45,
          follows: 2,
        },
        publishedAt: "2026-11-01T00:00:00Z",
      }),
    );
    expect(results[1].status).toBe("not_found");
    expect(videosList.mock.calls[0][0]).not.toHaveProperty("maxResults");
  });

  it("falls back to Data API statistics when the Analytics API is unavailable", async () => {
    videosList.mockResolvedValue({ data: { items: [{ id: "v", statistics: { viewCount: "7" } }] } });
    reportsQuery.mockRejectedValue(Object.assign(new Error("forbidden"), { response: { status: 403 } }));

    const publisher = new YouTubePublisher({ youtube: { credentials: { accessToken: "token-b" } } });
    const first = await publisher.getPostAnalytics([{ postId: "v" }]);
    const second = await publisher.getPostAnalytics([{ postId: "v" }]);

    expect(first.results[0]).toEqual(expect.objectContaining({ status: "ok", metrics: { views: 7 } }));
    expect(second.results[0].status).toBe("ok");
    // The unavailable Analytics API is skipped for a while instead of being retried on every read.
    expect(reportsQuery).toHaveBeenCalledTimes(1);
  });

  it("reads channel statistics and respects hidden subscriber counts", async () => {
    channelsList.mockResolvedValue({
      data: {
        items: [
          { statistics: { subscriberCount: "1200", hiddenSubscriberCount: true, videoCount: "8", viewCount: "99" } },
        ],
      },
    });
    const publisher = new YouTubePublisher({ youtube: { credentials: { accessToken: "token-c" } } });
    const result = await publisher.getAccountAnalytics();
    expect(result.metrics).toEqual({ posts: 8, totalViews: 99 });
  });
});
