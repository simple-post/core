import { getAccountPlatformConfig } from "../../src/lib/account/platforms.js";
import { normalizePeriod, periodQuery } from "../../src/lib/analytics/flags.js";
import { localDate, renderPostAnalytics, renderPostList, renderSummary } from "../../src/lib/analytics/render.js";
import { createColors } from "../../src/lib/ux/colors.js";

const colors = createColors(false);

describe("analytics flags", () => {
  it("accepts friendly period aliases", () => {
    expect(normalizePeriod("7d")).toBe("last_7d");
    expect(normalizePeriod("ytd")).toBe("this_year");
    expect(normalizePeriod("last-month")).toBe("last_month");
    expect(() => normalizePeriod("fortnight")).toThrow('Unknown period "fortnight"');
  });

  it("builds summary query parameters", () => {
    const params = periodQuery({
      period: "24h",
      timezone: "Europe/Berlin",
      platform: ["Twitter", "bluesky"],
      mode: "activity",
    });
    expect(params.get("period")).toBe("last_24h");
    expect(params.get("timeZone")).toBe("Europe/Berlin");
    expect(params.getAll("platform")).toEqual(["x", "bluesky"]);
    expect(params.get("mode")).toBe("activity");
    const custom = periodQuery({ from: "2026-01-01", to: "2026-01-31", timezone: "UTC" });
    expect(custom.has("period")).toBe(false);
    expect(custom.get("from")).toBe("2026-01-01");
  });
});

describe("analytics scopes", () => {
  const original = process.env.SIMPLEPOST_ANALYTICS_SCOPES;
  afterEach(() => {
    if (original === undefined) delete process.env.SIMPLEPOST_ANALYTICS_SCOPES;
    else process.env.SIMPLEPOST_ANALYTICS_SCOPES = original;
  });

  it("adds analytics permissions only when enabled", () => {
    delete process.env.SIMPLEPOST_ANALYTICS_SCOPES;
    expect(getAccountPlatformConfig("threads").oauthApp?.scopes).toEqual(["threads_basic", "threads_content_publish"]);
    expect(getAccountPlatformConfig("pinterest").oauthApp?.scopes).toContain("pins:read");
    process.env.SIMPLEPOST_ANALYTICS_SCOPES = "threads,tiktok";
    expect(getAccountPlatformConfig("threads").oauthApp?.scopes).toContain("threads_manage_insights");
    expect(getAccountPlatformConfig("tiktok").oauthApp?.scopes).toEqual(
      expect.arrayContaining(["video.list", "user.info.stats"]),
    );
    expect(getAccountPlatformConfig("facebook").oauthApp?.scopes).not.toContain("read_insights");
    process.env.SIMPLEPOST_ANALYTICS_SCOPES = "all";
    expect(getAccountPlatformConfig("instagram").oauthApp?.scopes).toContain("instagram_manage_insights");
  });
});

describe("analytics rendering", () => {
  it("prints dates in the summary's timezone", () => {
    expect(localDate("2026-10-31T15:00:00.000Z", "Asia/Tokyo")).toBe("2026-11-01");
    expect(localDate("2026-10-31T15:00:00.000Z")).toBe("2026-10-31");
  });

  const summary = {
    summary: {
      period: { key: "last_7d", start: "2026-11-14T00:00:00.000Z", end: "2026-11-21T00:00:00.000Z", timeZone: "UTC" },
      mode: "published" as const,
      totals: {
        posts: 4,
        publications: 6,
        metrics: { views: 12_500, likes: 80 },
        engagements: 95,
        engagementRate: 0.0076,
      },
      change: { posts: 0.5, views: -0.1, engagements: 0 },
      byPlatform: [
        { platform: "x", posts: 4, metrics: { views: 12_500 }, engagements: 95, engagementRate: 0.0076, share: 1 },
      ],
      topPosts: [
        {
          postId: "p1",
          message: "Hello world",
          publishedAt: "2026-11-20T10:00:00.000Z",
          platforms: ["x"],
          metrics: { views: 9000, likes: 50 },
          engagements: 60,
          engagementRate: 0.0067,
        },
      ],
      followers: [{ platform: "x", username: "me", current: 1200, change: 30 }],
      bestTimes: {
        byWeekday: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          posts: 1,
          averageEngagements: weekday === 3 ? 40 : 5,
        })),
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          posts: hour === 9 ? 2 : 0,
          averageEngagements: hour === 9 ? 30 : null,
        })),
      },
      coverage: { publications: 6, withData: 5, pending: 1, unavailable: 0, lastUpdatedAt: null },
      notices: [
        { platform: "instagram", username: "brand", message: "Reconnect this account.", reconnectRecommended: true },
      ],
    },
  };

  it("renders a period summary", () => {
    const text = renderSummary(summary, colors);
    expect(text).toContain("Analytics · last 7d");
    expect(text).toMatch(/Views\s+12\.5K -10%/);
    expect(text).toMatch(/Posts\s+4 \+50%/);
    expect(text).toContain("1. Hello world (X, 2026-11-20)");
    expect(text).toContain("Views 9,000 · Likes 50 · Engagements 60 p1");
    expect(text).toContain("@me");
    expect(text).toContain("Best time to post: Thursday around 09:00");
    expect(text).toContain("Note: Instagram @brand — Reconnect this account. Reconnect it in the SimplePost web app.");
    expect(text).toContain("1 publications have not been read yet");
  });

  it("renders ranked posts and single-post analytics", () => {
    expect(
      renderPostList(
        { posts: summary.summary.topPosts, pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } },
        "likes",
        colors,
      ),
    ).toContain("11. Hello world");
    const text = renderPostAnalytics(
      {
        analytics: {
          postId: "p1",
          publishedAt: "2026-11-20T10:00:00.000Z",
          notPublished: false,
          lastUpdatedAt: null,
          totals: { metrics: { likes: 3 }, engagements: 3, engagementRate: null },
          accounts: [
            {
              platform: "bluesky",
              username: "me.bsky.social",
              status: "ok",
              message: null,
              postUrl: "https://bsky.app/profile/me/post/1",
              platformMetrics: { likeCount: 3 },
              metrics: { likes: 3 },
              engagements: 3,
              engagementRate: null,
            },
          ],
        },
      },
      colors,
      true,
    );
    expect(text).toContain("● Bluesky @me.bsky.social: Likes 3");
    expect(text).toContain("likeCount: 3");
  });
});
