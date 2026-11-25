import { NextRequest } from "next/server";

import { getAccountAnalytics, getPostAnalytics } from "@simple-post/sdk";

import { GET as getSummary } from "@/app/api/v1/analytics/summary/route";
import { GET as getPostAnalyticsRoute } from "@/app/api/v1/posts/[id]/analytics/route";
import {
  getAccountAnalyticsTool,
  getAnalyticsSummaryTool,
  getPostAnalyticsTool,
  listPostAnalyticsTool,
} from "@/lib/mcp/tools/analytics";
import { requireAuth } from "@/lib/middleware/auth";
import { runBackgroundAnalyticsRefresh } from "@/lib/post-analytics/background";
import { getAnalyticsSummary, listPostAnalytics } from "@/lib/post-analytics/query";
import { ensureAnalyticsRowsForUser, refreshAnalyticsForUser } from "@/lib/post-analytics/service";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

// Real PostgreSQL, Prisma queries and refresh bookkeeping; only provider I/O
// (the SDK's analytics readers) is substituted.
jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  getPostAnalytics: jest.fn(),
  getAccountAnalytics: jest.fn(),
}));
jest.mock("@/lib/middleware/auth", () => {
  const authenticate = jest.fn();
  return { requireAuth: authenticate, requireReadAuth: authenticate };
});
jest.mock("@/lib/post-analytics/access", () => ({
  ...jest.requireActual("@/lib/post-analytics/access"),
  canRefreshAnalytics: jest.fn().mockResolvedValue(true),
}));

const userId = "analytics-review";
const HOUR = 3_600_000;
const mockedPostAnalytics = jest.mocked(getPostAnalytics);
const mockedAccountAnalytics = jest.mocked(getAccountAnalytics);

async function createAccount(id: string, platform: string, scope: string | null = null) {
  await prisma.connectedAccount.create({
    data: {
      id,
      userId,
      platform,
      platformAccountId: `${id}-remote`,
      username: id,
      scope,
      ...encryptConnectedAccountSecrets({ accessToken: "token", refreshToken: null }),
    },
  });
}

async function createPost(
  id: string,
  publishedAt: Date,
  results: Record<string, { platform: string; postId: string }>,
) {
  await prisma.post.create({
    data: {
      id,
      userId,
      message: `Post ${id}`,
      status: "published",
      publishedAt,
      accounts: { connect: Object.keys(results).map((accountId) => ({ id: accountId })) },
      accountResults: Object.fromEntries(
        Object.entries(results).map(([accountId, result]) => [
          accountId,
          { accountId, ...result, success: true, completedAt: publishedAt.toISOString() },
        ]),
      ),
    },
  });
}

function respondWith(metrics: Record<string, Record<string, number>>) {
  mockedPostAnalytics.mockImplementation(async ({ platform, targets }) => ({
    platform,
    results: targets.map((target) => ({
      platform,
      postId: target.postId,
      status: metrics[target.postId] ? "ok" : "not_found",
      metrics: metrics[target.postId] ?? {},
      fetchedAt: new Date().toISOString(),
    })),
  }));
}

const request = (url: string) => new NextRequest(new URL(url, "http://localhost"));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
  delete process.env.X_ANALYTICS_DAILY_POST_READS;
  delete process.env.POST_ANALYTICS_BACKGROUND_PLATFORMS;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({ data: { id: userId, name: "Analytics", email: "analytics@example.invalid" } });
  await prisma.userFeature.create({ data: { userId, feature: "POST_ANALYTICS" } });
  await createAccount("x1", "x");
  await createAccount("bsky1", "bluesky");
  await createAccount("tg1", "telegram");
  mockedAccountAnalytics.mockImplementation(async ({ platform }) => ({
    platform,
    status: "ok",
    metrics: { followers: 100 },
    fetchedAt: new Date().toISOString(),
  }));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("post analytics", () => {
  it("reads, caches and snapshots analytics when a post is opened", async () => {
    const publishedAt = new Date(Date.now() - 2 * HOUR);
    await createPost("p1", publishedAt, {
      x1: { platform: "x", postId: "111" },
      bsky1: { platform: "bluesky", postId: "at://did/app.bsky.feed.post/1" },
      tg1: { platform: "telegram", postId: "5" },
    });
    respondWith({
      "111": { views: 500, likes: 10, comments: 2 },
      "at://did/app.bsky.feed.post/1": { likes: 5, shares: 1 },
    });

    const response = await getPostAnalyticsRoute(request("/api/v1/posts/p1/analytics"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const { analytics } = await response.json();

    expect(response.status).toBe(200);
    expect(mockedPostAnalytics).toHaveBeenCalledTimes(2);
    expect(analytics.totals).toEqual({
      metrics: { views: 500, likes: 15, comments: 2, shares: 1 },
      engagements: 18,
      engagementRate: 0.024,
    });
    const telegram = analytics.accounts.find((account: { platform: string }) => account.platform === "telegram");
    expect(telegram).toEqual(expect.objectContaining({ status: "unsupported", isStale: false }));
    expect(await prisma.postAnalyticsSnapshot.count({ where: { userId } })).toBe(2);

    // Within the freshness window the cache answers without provider requests.
    mockedPostAnalytics.mockClear();
    await getPostAnalyticsRoute(request("/api/v1/posts/p1/analytics"), { params: Promise.resolve({ id: "p1" }) });
    expect(mockedPostAnalytics).not.toHaveBeenCalled();

    // A forced refresh right after a read is held back by the two-minute floor.
    await getPostAnalyticsRoute(request("/api/v1/posts/p1/analytics?refresh=force"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(mockedPostAnalytics).not.toHaveBeenCalled();
  });

  it("keeps previous numbers when a later read fails", async () => {
    await createPost("p2", new Date(Date.now() - HOUR), { x1: { platform: "x", postId: "222" } });
    respondWith({ "222": { views: 40, likes: 4 } });
    await refreshAnalyticsForUser(userId, { postIds: ["p2"] });

    await prisma.postAnalytics.updateMany({ where: { postId: "p2" }, data: { nextRefreshAt: new Date(0) } });
    mockedPostAnalytics.mockImplementation(async ({ platform, targets }) => ({
      platform,
      results: targets.map((target) => ({
        platform,
        postId: target.postId,
        status: "rate_limited" as const,
        metrics: {},
        message: "slow down",
        fetchedAt: new Date().toISOString(),
      })),
    }));
    await refreshAnalyticsForUser(userId, { postIds: ["p2"] });

    const row = await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "p2" } });
    expect(row).toEqual(expect.objectContaining({ status: "rate_limited", views: 40, likes: 4, failureCount: 1 }));
    expect(row.nextRefreshAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
  });

  it("caps distinct X post reads per user per day", async () => {
    process.env.X_ANALYTICS_DAILY_POST_READS = "1";
    await createPost("p3", new Date(Date.now() - HOUR), { x1: { platform: "x", postId: "333" } });
    await createPost("p4", new Date(Date.now() - HOUR), { x1: { platform: "x", postId: "444" } });
    respondWith({ "333": { likes: 1 }, "444": { likes: 2 } });

    await refreshAnalyticsForUser(userId, { postIds: ["p3", "p4"] });

    expect(mockedPostAnalytics).toHaveBeenCalledTimes(1);
    expect(mockedPostAnalytics.mock.calls[0][0].targets).toHaveLength(1);
    const deferred = await prisma.postAnalytics.findFirstOrThrow({ where: { userId, status: "pending" } });
    expect(deferred.message).toContain("daily X analytics limit");
    expect(deferred.nextRefreshAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("summarizes a period with comparison, platforms, timeline, top posts and followers", async () => {
    const now = Date.now();
    await createPost("recent", new Date(now - 2 * 24 * HOUR), {
      x1: { platform: "x", postId: "501" },
      bsky1: { platform: "bluesky", postId: "at://did/app.bsky.feed.post/5" },
    });
    await createPost("older", new Date(now - 10 * 24 * HOUR), { x1: { platform: "x", postId: "502" } });
    respondWith({
      "501": { views: 1000, likes: 50 },
      "at://did/app.bsky.feed.post/5": { likes: 20, comments: 5 },
      "502": { views: 200, likes: 4 },
    });
    await refreshAnalyticsForUser(userId, { since: new Date(now - 30 * 24 * HOUR) });

    const response = await getSummary(request("/api/v1/analytics/summary?period=last_7d&timeZone=Europe/Berlin"));
    const { summary } = await response.json();

    expect(summary.totals).toEqual(
      expect.objectContaining({
        posts: 1,
        publications: 2,
        engagements: 75,
        metrics: { views: 1000, likes: 70, comments: 5 },
      }),
    );
    expect(summary.previous).toEqual(expect.objectContaining({ posts: 1, engagements: 4 }));
    expect(summary.change.engagements).toBeCloseTo(17.75);
    expect(summary.byPlatform.map((entry: { platform: string }) => entry.platform)).toEqual(["x", "bluesky"]);
    expect(summary.timeline).toHaveLength(8);
    expect(summary.timeline.reduce((sum: number, bucket: { posts: number }) => sum + bucket.posts, 0)).toBe(1);
    expect(summary.topPosts[0]).toEqual(expect.objectContaining({ postId: "recent", engagements: 75 }));
    expect(summary.followers).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: "x1", current: 100 })]),
    );
    expect(summary.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: "tg1", reconnectRecommended: false })]),
    );

    const list = await listPostAnalytics(userId, { period: "last_30d", sortBy: "views" });
    expect(list.posts.map((post) => post.postId)).toEqual(["recent", "older"]);
  });

  it("reports metrics gained during a period from snapshots", async () => {
    const now = Date.now();
    await createPost("evergreen", new Date(now - 40 * 24 * HOUR), { bsky1: { platform: "bluesky", postId: "at://e" } });
    respondWith({ "at://e": { likes: 10 } });
    await refreshAnalyticsForUser(userId, { postIds: ["evergreen"] });
    const row = await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "evergreen" } });
    await prisma.postAnalyticsSnapshot.updateMany({
      where: { analyticsId: row.id },
      data: { capturedAt: new Date(now - 3 * 24 * HOUR) },
    });
    await prisma.postAnalyticsSnapshot.create({
      data: { analyticsId: row.id, userId, capturedAt: new Date(now - HOUR), likes: 16, engagements: 16 },
    });

    const activity = await getAnalyticsSummary(userId, { period: "last_24h", mode: "activity" });
    expect(activity.totals).toEqual(expect.objectContaining({ engagements: 6, metrics: { likes: 6 } }));
    expect(activity.topPosts[0]).toEqual(expect.objectContaining({ postId: "evergreen", engagements: 6 }));

    const published = await getAnalyticsSummary(userId, { period: "last_24h" });
    expect(published.totals.posts).toBe(0);
  });

  it("refreshes in the background without reading X", async () => {
    await createPost("bg", new Date(Date.now() - HOUR), {
      x1: { platform: "x", postId: "601" },
      bsky1: { platform: "bluesky", postId: "at://bg" },
    });
    respondWith({ "601": { likes: 1 }, "at://bg": { likes: 2 } });

    const result = await runBackgroundAnalyticsRefresh();

    expect(mockedAccountAnalytics.mock.calls.map(([call]) => call.platform)).not.toContain("x");
    expect(result.seededPosts).toBeGreaterThanOrEqual(1);
    expect(mockedPostAnalytics.mock.calls.map(([call]) => call.platform)).toEqual(["bluesky"]);
    expect(await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "bg", platform: "x" } })).toEqual(
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("keeps ungranted users out of reads, fresh collection and existing background work", async () => {
    const other = "analytics-disabled-review";
    await prisma.user.create({ data: { id: other, email: "disabled@example.invalid", name: "Disabled" } });
    try {
      await createPost("eligible", new Date(), { bsky1: { platform: "bluesky", postId: "eligible-remote" } });
      await createPost("old-row", new Date(), { x1: { platform: "x", postId: "old-remote" } });
      await ensureAnalyticsRowsForUser(userId, { postIds: ["old-row"] });
      await prisma.postAnalytics.updateMany({ where: { postId: "old-row" }, data: { userId: other } });
      await prisma.connectedAccount.update({ where: { id: "x1" }, data: { userId: other } });
      await prisma.post.update({ where: { id: "old-row" }, data: { userId: other } });
      await createPost("unseeded", new Date(), { x1: { platform: "x", postId: "unseeded-remote" } });
      await prisma.post.update({ where: { id: "unseeded" }, data: { userId: other } });
      jest.mocked(requireAuth).mockResolvedValue({ user: { id: other } } as never);
      const denied = await getPostAnalyticsRoute(request("/api/v1/posts/unseeded/analytics"), {
        params: Promise.resolve({ id: "unseeded" }),
      });
      expect(denied.status).toBe(403);
      await expect(getAccountAnalyticsTool(other, { refresh: "auto" })).rejects.toThrow();
      process.env.POST_ANALYTICS_BACKGROUND_PLATFORMS = "all";
      respondWith({ "eligible-remote": { likes: 1 } });
      await runBackgroundAnalyticsRefresh();
      expect(mockedPostAnalytics.mock.calls.map(([call]) => call.platform)).toEqual(["bluesky"]);
      expect(mockedAccountAnalytics.mock.calls.map(([call]) => call.platform)).not.toContain("x");
      expect(await prisma.postAnalytics.count({ where: { postId: "unseeded" } })).toBe(0);
      expect(await prisma.postAnalyticsSnapshot.count({ where: { userId: other } })).toBe(0);
      expect(await prisma.accountAnalyticsSnapshot.count({ where: { userId: other } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: other } });
    }
  });

  it("answers MCP analytics questions with structured data and readable text", async () => {
    const now = Date.now();
    await createPost("m1", new Date(now - 3 * HOUR), {
      x1: { platform: "x", postId: "701" },
      bsky1: { platform: "bluesky", postId: "at://m1" },
    });
    await createPost("m2", new Date(now - 30 * HOUR), { bsky1: { platform: "bluesky", postId: "at://m2" } });
    respondWith({ "701": { views: 900, likes: 30, comments: 3 }, "at://m1": { likes: 12 }, "at://m2": { likes: 50 } });

    const summary = await getAnalyticsSummaryTool(userId, {
      period: "last_7d",
      timeZone: "UTC",
      mode: "published",
      compare: true,
      topLimit: 5,
      topSortBy: "engagements",
      refresh: "auto",
    });
    expect(summary.result.summary.totals.posts).toBe(2);
    expect(summary.text).toContain("Analytics for the last 7 days");
    expect(summary.text).toContain("Views: 900");
    expect(summary.text).toContain("Bluesky: 2 posts");
    expect(summary.text).toContain("[postId m2]");

    const ranked = await listPostAnalyticsTool(userId, {
      period: "last_7d",
      mode: "published",
      sortBy: "likes",
      order: "asc",
      limit: 10,
      page: 1,
      refresh: "none",
    });
    expect(ranked.result.posts.map((post) => post.postId)).toEqual(["m1", "m2"]);
    expect(ranked.text).toContain("lowest first");

    const post = await getPostAnalyticsTool(userId, { postIds: ["m1", "missing"], refresh: "none" });
    expect(post.result.notFound).toEqual(["missing"]);
    expect(post.text).toContain("X (Twitter) @x1: views 900, likes 30, comments 3");
    expect(post.text).toContain("Bluesky @bsky1: likes 12");

    const accounts = await getAccountAnalyticsTool(userId, { refresh: "auto" });
    expect(accounts.text).toContain("followers 100");
    expect(accounts.text).toContain("Telegram @tg1");
    expect(accounts.text).toContain("post analytics unavailable");
  });

  it("adds rows for accounts that succeed on a retry", async () => {
    const publishedAt = new Date(Date.now() - HOUR);
    await createPost("retry", publishedAt, { x1: { platform: "x", postId: "801" } });
    await prisma.post.update({ where: { id: "retry" }, data: { accounts: { connect: { id: "bsky1" } } } });
    await ensureAnalyticsRowsForUser(userId, { since: new Date(Date.now() - 24 * HOUR) });
    expect(await prisma.postAnalytics.count({ where: { postId: "retry" } })).toBe(1);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: "retry" } });
    await prisma.post.update({
      where: { id: "retry" },
      data: {
        accountResults: {
          ...(post.accountResults as object),
          bsky1: {
            accountId: "bsky1",
            platform: "bluesky",
            postId: "at://retry",
            success: true,
            completedAt: new Date().toISOString(),
          },
        },
      },
    });
    await ensureAnalyticsRowsForUser(userId, { since: new Date(Date.now() - 24 * HOUR) });
    expect(await prisma.postAnalytics.count({ where: { postId: "retry" } })).toBe(2);
  });

  it("keeps a resolved TikTok video id when the post is opened again", async () => {
    await createAccount("tt1", "tiktok");
    await createPost("tt", new Date(Date.now() - HOUR), { tt1: { platform: "tiktok", postId: "v_pub_abc" } });
    mockedPostAnalytics.mockImplementation(async ({ platform, targets }) => ({
      platform,
      results: targets.map((target) => ({
        platform,
        postId: target.postId,
        status: "ok" as const,
        metrics: { views: 10 },
        resolvedPostId: target.postId === "v_pub_abc" ? "7300" : undefined,
        fetchedAt: new Date().toISOString(),
      })),
    }));
    await refreshAnalyticsForUser(userId, { postIds: ["tt"] });
    await ensureAnalyticsRowsForUser(userId, { postIds: ["tt"] });
    expect(await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "tt" } })).toEqual(
      expect.objectContaining({ platformPostId: "7300", sourcePostId: "v_pub_abc", status: "ok" }),
    );
  });

  it("accumulates snapshots across intervals instead of moving one forward", async () => {
    await createPost("snap", new Date(Date.now() - 2 * HOUR), { bsky1: { platform: "bluesky", postId: "at://snap" } });
    respondWith({ "at://snap": { likes: 1 } });
    await refreshAnalyticsForUser(userId, { postIds: ["snap"] });
    const row = await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "snap" } });
    // Pretend the first reading happened in the previous hour bucket.
    await prisma.postAnalyticsSnapshot.updateMany({
      where: { analyticsId: row.id },
      data: { capturedAt: new Date(Math.floor(Date.now() / HOUR) * HOUR - 10 * 60_000) },
    });
    await prisma.postAnalytics.update({
      where: { id: row.id },
      data: { nextRefreshAt: new Date(0), fetchedAt: new Date(0) },
    });
    respondWith({ "at://snap": { likes: 3 } });
    await refreshAnalyticsForUser(userId, { postIds: ["snap"] });
    expect(await prisma.postAnalyticsSnapshot.count({ where: { analyticsId: row.id } })).toBe(2);
  });

  it("backs off rows whose account read throws", async () => {
    await createPost("boom", new Date(Date.now() - HOUR), { bsky1: { platform: "bluesky", postId: "at://boom" } });
    mockedPostAnalytics.mockRejectedValue(new Error("unexpected"));
    await refreshAnalyticsForUser(userId, { postIds: ["boom"] });
    const row = await prisma.postAnalytics.findFirstOrThrow({ where: { postId: "boom" } });
    expect(row).toEqual(expect.objectContaining({ status: "error", failureCount: 1, leaseToken: null }));
    expect(row.nextRefreshAt.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
  });
});
