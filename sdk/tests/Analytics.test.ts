import axios from "axios";

import {
  addPostMetrics,
  computeEngagementRate,
  computeEngagements,
  getPostAnalytics,
  normalizePostMetrics,
  PLATFORM_ANALYTICS_CAPABILITIES,
  POST_METRICS,
} from "../src";
import { BlueskyPublisher } from "../src/publishers/bluesky";
import { FacebookPublisher } from "../src/publishers/facebook";
import { ForemPublisher } from "../src/publishers/forem";
import { InstagramPublisher } from "../src/publishers/instagram";
import { LinkedInPublisher } from "../src/publishers/linkedin";
import { linkedInEntity } from "../src/publishers/linkedin/analytics";
import { PinterestPublisher } from "../src/publishers/pinterest";
import { TelegramPublisher } from "../src/publishers/telegram";
import { ThreadsPublisher } from "../src/publishers/threads";
import { TikTokPublisher } from "../src/publishers/tiktok";
import { XPublisher } from "../src/publishers/x";
import { mapXPost, xPostCreatedAt } from "../src/publishers/x/analytics";
import { classifyAnalyticsError } from "../src/utils/analytics";

jest.mock("axios");
jest.mock("../src/utils/s3", () => ({
  S3MediaUploader: jest.fn().mockImplementation(() => ({ uploadFile: jest.fn(), deleteFile: jest.fn() })),
}));

const mocked = axios as jest.Mocked<typeof axios>;

function client() {
  const instance = { get: jest.fn(), post: jest.fn() };
  mocked.create.mockReturnValue(instance as never);
  return instance;
}

function httpError(status: number, data?: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}

function metaError(code: number, message = "error", status = 400) {
  return httpError(status, { error: { code, message } });
}

/** A recent and a two-year-old X post id (snowflakes encode their creation time). */
function xId(date: Date): string {
  return ((BigInt(date.getTime()) - 1_288_834_974_657n) << 22n).toString();
}

beforeEach(() => jest.resetAllMocks());

describe("analytics model", () => {
  it("computes engagements only from reported interaction metrics", () => {
    expect(computeEngagements({ views: 100 })).toBeUndefined();
    expect(computeEngagements({ likes: 3, comments: 2, shares: 1, saves: 4, clicks: 50 })).toBe(10);
    expect(computeEngagementRate({ views: 200, likes: 10 })).toBe(0.05);
    expect(computeEngagementRate({ reach: 50, likes: 10 })).toBe(0.2);
    expect(computeEngagementRate({ likes: 10 })).toBeUndefined();
  });

  it("adds metrics without inventing zeros for unreported ones", () => {
    const total = addPostMetrics({}, { likes: 2, views: 10 });
    addPostMetrics(total, { likes: 3, averageWatchTimeSeconds: 9 });
    expect(total).toEqual({ likes: 5, views: 10 });
  });

  it("normalizes provider numbers", () => {
    expect(normalizePostMetrics({ views: "12", likes: -1, comments: Number.NaN, shares: 4, unknown: 3 })).toEqual({
      views: 12,
      shares: 4,
    });
  });

  it("describes every platform with known metrics", () => {
    for (const capability of Object.values(PLATFORM_ANALYTICS_CAPABILITIES)) {
      for (const metric of capability.postMetrics) expect(POST_METRICS).toContain(metric);
      if (capability.posts) expect(capability.batchSize).toBeGreaterThan(0);
    }
  });

  it("classifies provider errors", () => {
    expect(classifyAnalyticsError(httpError(401), "X").status).toBe("credentials_error");
    expect(classifyAnalyticsError(httpError(403), "X").status).toBe("missing_permission");
    expect(classifyAnalyticsError(httpError(404), "X").status).toBe("not_found");
    expect(classifyAnalyticsError(httpError(429), "X").status).toBe("rate_limited");
    expect(classifyAnalyticsError(metaError(10), "Instagram").status).toBe("missing_permission");
    expect(classifyAnalyticsError(metaError(190), "Instagram").status).toBe("credentials_error");
    expect(classifyAnalyticsError(metaError(80_002), "Instagram").status).toBe("rate_limited");
    expect(classifyAnalyticsError(new Error("boom"), "X")).toEqual({
      status: "error",
      message: "X analytics request failed: boom",
    });
  });

  it("returns a credentials error per target when the publisher cannot be created", async () => {
    const result = await getPostAnalytics({
      platform: "linkedin",
      targets: [{ postId: "urn:li:share:1" }],
    });
    expect(result.results).toEqual([
      expect.objectContaining({ postId: "urn:li:share:1", status: "credentials_error", metrics: {} }),
    ]);
  });
});

describe("X analytics", () => {
  const options = { x: { credentials: { accessToken: "token", username: "simplepost" } } };

  it("decodes post creation time from snowflake ids", () => {
    const date = new Date("2026-11-01T10:00:00.000Z");
    expect(xPostCreatedAt(xId(date))?.toISOString()).toBe(date.toISOString());
    expect(xPostCreatedAt("not-an-id")).toBeUndefined();
  });

  it("maps public and private metrics, accepting renamed fields", () => {
    expect(
      mapXPost({
        public_metrics: { impression_count: 900, like_count: 9, reply_count: 2, repost_count: 3, quote_count: 1 },
        non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 4 },
      }).metrics,
    ).toEqual({ views: 900, likes: 9, comments: 2, shares: 3, quotes: 1, clicks: 7, profileVisits: 4 });
  });

  it("requests private metrics only for posts younger than 30 days", async () => {
    const recent = xId(new Date(Date.now() - 2 * 86_400_000));
    const old = xId(new Date(Date.now() - 400 * 86_400_000));
    mocked.get.mockImplementation(async (_url, config) => {
      const params = (config as { params: Record<string, string> }).params;
      if (params.ids === recent) {
        expect(params["tweet.fields"]).toContain("non_public_metrics");
        return { data: { data: [{ id: recent, public_metrics: { like_count: 5, bookmark_count: 2 } }] } };
      }
      expect(params["tweet.fields"]).not.toContain("non_public_metrics");
      return { data: { errors: [{ resource_id: old, detail: "Could not find tweet" }] } };
    });

    const { results } = await new XPublisher(options).getPostAnalytics([{ postId: recent }, { postId: old }]);

    expect(mocked.get).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: { likes: 5, saves: 2 },
        url: `https://x.com/simplepost/status/${recent}`,
      }),
    );
    expect(results[1]).toEqual(expect.objectContaining({ status: "not_found", message: "Could not find tweet" }));
  });

  it("isolates a failing batch to its own targets", async () => {
    mocked.get.mockRejectedValue(httpError(429, { title: "Too Many Requests" }));
    const { results } = await new XPublisher(options).getPostAnalytics([{ postId: "1" }]);
    expect(results).toEqual([expect.objectContaining({ postId: "1", status: "rate_limited" })]);
  });

  it("reads follower counts", async () => {
    mocked.get.mockResolvedValue({
      data: { data: { public_metrics: { followers_count: 10, following_count: 2, tweet_count: 30 } } },
    });
    const result = await new XPublisher(options).getAccountAnalytics();
    expect(result).toEqual(
      expect.objectContaining({ status: "ok", metrics: { followers: 10, following: 2, posts: 30 } }),
    );
  });
});

describe("Bluesky analytics", () => {
  const options = {
    bluesky: { credentials: { identifier: "me.bsky.social", appPassword: "app-password" } },
  };
  const uri = (index: number) => `at://did:plc:abc/app.bsky.feed.post/${index}`;

  it("reads public counts in batches of 25 without authentication", async () => {
    mocked.create.mockReturnValue({} as never);
    mocked.get.mockImplementation(async (_url, config) => {
      const uris = (config as { params: URLSearchParams }).params.getAll("uris");
      return {
        data: {
          posts: uris.map((value) => ({
            uri: value,
            author: { handle: "me.bsky.social" },
            likeCount: 4,
            replyCount: 1,
            repostCount: 2,
            quoteCount: 0,
            bookmarkCount: 3,
          })),
        },
      };
    });
    const targets = Array.from({ length: 26 }, (_, index) => ({ postId: uri(index) }));

    const { results } = await new BlueskyPublisher(options).getPostAnalytics(targets);

    expect(mocked.get).toHaveBeenCalledTimes(2);
    expect(mocked.get.mock.calls[0][1]).not.toHaveProperty("headers");
    expect(results).toHaveLength(26);
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: { likes: 4, comments: 1, shares: 2, quotes: 0, saves: 3 },
        url: "https://bsky.app/profile/me.bsky.social/post/0",
      }),
    );
  });

  it("reports deleted posts as not found", async () => {
    mocked.create.mockReturnValue({} as never);
    mocked.get.mockResolvedValue({ data: { posts: [] } });
    const { results } = await new BlueskyPublisher(options).getPostAnalytics([{ postId: uri(1) }]);
    expect(results[0].status).toBe("not_found");
  });
});

describe("TikTok analytics", () => {
  const options = { tiktok: { credentials: { accessToken: "token" } } };

  it("resolves publish ids to public videos and reads their statistics", async () => {
    const api = client();
    api.post.mockImplementation(async (url: string) => {
      if (url === "/v2/post/publish/status/fetch/")
        return { data: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [987] } } };
      return {
        data: {
          data: {
            videos: [
              {
                id: "987",
                view_count: 100,
                like_count: 9,
                comment_count: 2,
                share_count: 1,
                create_time: 1_700_000_000,
              },
              { id: "555", view_count: 5 },
            ],
          },
          error: { code: "ok" },
        },
      };
    });

    const { results } = await new TikTokPublisher(options).getPostAnalytics([
      { postId: "v_pub_url~123" },
      { postId: "555" },
    ]);

    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        resolvedPostId: "987",
        metrics: { views: 100, likes: 9, comments: 2, shares: 1 },
      }),
    );
    expect(results[1]).toEqual(expect.objectContaining({ status: "ok", metrics: { views: 5 } }));
  });

  it("explains inbox uploads that are not public yet", async () => {
    const api = client();
    api.post.mockResolvedValue({ data: { data: { status: "SEND_TO_USER_INBOX" } } });
    const { results } = await new TikTokPublisher(options).getPostAnalytics([{ postId: "v_inbox~1" }]);
    expect(results[0]).toEqual(
      expect.objectContaining({ status: "unsupported", message: expect.stringContaining("inbox") }),
    );
  });

  it("maps a missing scope to missing_permission", async () => {
    const api = client();
    api.post.mockRejectedValue(httpError(401, { error: { code: "scope_not_authorized", message: "no scope" } }));
    const { results } = await new TikTokPublisher(options).getPostAnalytics([{ postId: "123" }]);
    expect(results[0].status).toBe("missing_permission");
  });
});

describe("Pinterest analytics", () => {
  const options = { pinterest: { boardId: "b", credentials: { accessToken: "token" } } };

  it("maps lifetime pin metrics", async () => {
    const api = client();
    api.get.mockResolvedValue({
      data: {
        created_at: "2026-11-01T00:00:00",
        pin_metrics: {
          "90d": { impression: 10, pin_click: 1 },
          lifetime_metrics: { impression: 50, pin_click: 4, clickthrough: 2, reaction: 3, comment: 1, save: 6 },
        },
      },
    });
    const { results } = await new PinterestPublisher(options).getPostAnalytics([{ postId: "42" }]);
    expect(api.get).toHaveBeenCalledWith("/pins/42", expect.objectContaining({ params: { pin_metrics: true } }));
    expect(results[0].metrics).toEqual({ views: 50, clicks: 6, saves: 6, likes: 3, comments: 1 });
  });

  it("explains the business-account restriction", async () => {
    const api = client();
    api.get.mockRejectedValue(httpError(403, { code: 403, message: "PINNER_DATA_ACCESS_DENIED" }));
    const { results } = await new PinterestPublisher(options).getPostAnalytics([{ postId: "42" }]);
    expect(results[0]).toEqual(
      expect.objectContaining({ status: "missing_permission", message: expect.stringContaining("business account") }),
    );
  });
});

describe("Facebook analytics", () => {
  const options = { facebook: { credentials: { pageAccessToken: "page-token", pageId: "page" } } };

  it("reads feed post counters and media-view insights", async () => {
    const api = client();
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/insights"))
        return {
          data: {
            data: [
              { name: "post_media_view", values: [{ value: 300 }] },
              { name: "post_total_media_view_unique", values: [{ value: 120 }] },
              { name: "post_clicks", values: [{ value: 8 }] },
            ],
          },
        };
      return {
        data: {
          permalink_url: "https://facebook.com/page/posts/1",
          shares: { count: 2 },
          reactions: { summary: { total_count: 11 } },
          comments: { summary: { total_count: 4 } },
        },
      };
    });

    const { results } = await new FacebookPublisher(options).getPostAnalytics([{ postId: "page_1" }]);

    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: { views: 300, reach: 120, clicks: 8, likes: 11, comments: 4, shares: 2 },
        url: "https://facebook.com/page/posts/1",
      }),
    );
  });

  it("keeps counters when the insights permission is missing", async () => {
    const api = client();
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/insights")) throw metaError(10, "Requires read_insights", 403);
      return { data: { reactions: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } } };
    });
    const { results } = await new FacebookPublisher(options).getPostAnalytics([{ postId: "page_1" }]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: { likes: 1, comments: 0, shares: 0 },
        message: expect.stringContaining("permission"),
      }),
    );
  });

  it("reads videos with Reels insights and converts milliseconds", async () => {
    const api = client();
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/video_insights"))
        return {
          data: {
            data: [
              { name: "fb_reels_total_plays", values: [{ value: 70 }] },
              { name: "post_video_avg_time_watched", values: [{ value: 4500 }] },
              { name: "post_video_social_actions", values: [{ value: { SHARE: 3, COMMENT: 1 } }] },
            ],
          },
        };
      return { data: { likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } } } };
    });
    const { results } = await new FacebookPublisher(options).getPostAnalytics([{ postId: "9001" }]);
    expect(api.get).toHaveBeenCalledWith("/9001/video_insights", expect.anything());
    expect(results[0].metrics).toEqual({ views: 70, likes: 5, comments: 1, shares: 3, averageWatchTimeSeconds: 4.5 });
  });
});

describe("Instagram analytics", () => {
  const options = { instagram: { credentials: { accessToken: "token", businessAccountId: "ig" } } };

  it("requests Reels metrics for videos and retries metrics one by one when Meta rejects one", async () => {
    const api = client();
    api.get.mockImplementation(async (path: string, config: { params: Record<string, string> }) => {
      if (!path.endsWith("/insights")) return { data: { like_count: 1, comments_count: 1, media_type: "VIDEO" } };
      const metric = config.params.metric;
      if (metric.includes(",")) throw metaError(100, "(#100) metric[0] must be one of …");
      if (metric === "saved") throw metaError(100, "unsupported");
      return {
        data: { data: [{ name: metric, values: [{ value: metric === "ig_reels_avg_watch_time" ? 2500 : 7 }] }] },
      };
    });

    const { results } = await new InstagramPublisher(options).getPostAnalytics([{ postId: "m1", mediaType: "video" }]);

    const multi = api.get.mock.calls.find(
      ([path, config]) => path === "/m1/insights" && config.params.metric.includes(","),
    );
    expect(multi?.[1].params.metric).toContain("ig_reels_avg_watch_time");
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: expect.objectContaining({ views: 7, reach: 7, likes: 7, averageWatchTimeSeconds: 2.5 }),
      }),
    );
    expect(results[0].metrics.saves).toBeUndefined();
  });
});

describe("Threads analytics", () => {
  it("maps replies and combines reposts with shares", async () => {
    const api = client();
    api.get.mockResolvedValue({
      data: {
        data: ["views", "likes", "replies", "reposts", "quotes", "shares"].map((name, index) => ({
          name,
          values: [{ value: index + 1 }],
        })),
      },
    });
    const options = { threads: { credentials: { accessToken: "token", userId: "u" } } };
    const { results } = await new ThreadsPublisher(options).getPostAnalytics([{ postId: "t1" }]);
    expect(results[0].metrics).toEqual({ views: 1, likes: 2, comments: 3, shares: 4 + 6, quotes: 5 });
  });
});

describe("Forem analytics", () => {
  it("reads page views for the author's articles in one request", async () => {
    mocked.get.mockResolvedValue({
      data: [
        { id: 1, url: "https://dev.to/me/a", page_views_count: 40, public_reactions_count: 5, comments_count: 2 },
        { id: 2, page_views_count: 1 },
      ],
    });
    const options = { forem: { credentials: { instanceUrl: "https://dev.to", apiKey: "key" } } };
    const { results } = await new ForemPublisher(options).getPostAnalytics([{ postId: "1" }, { postId: "3" }]);
    expect(mocked.get).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
        metrics: { views: 40, likes: 5, comments: 2 },
        url: "https://dev.to/me/a",
      }),
    );
    expect(results[1].status).toBe("not_found");
  });
});

describe("LinkedIn analytics", () => {
  const options = { linkedin: { credentials: { accessToken: "token", memberId: "m" } } };

  it("encodes share and ugcPost URNs as Rest.li unions", () => {
    expect(linkedInEntity("urn:li:share:1")).toBe("(share:urn%3Ali%3Ashare%3A1)");
    expect(linkedInEntity("urn:li:ugcPost:2")).toBe("(ugc:urn%3Ali%3AugcPost%3A2)");
    expect(linkedInEntity("123")).toBeUndefined();
  });

  it("reads one metric per request", async () => {
    client();
    mocked.get.mockResolvedValue({ data: { elements: [{ count: 6 }] } });
    const { results } = await new LinkedInPublisher(options).getPostAnalytics([{ postId: "urn:li:share:1" }]);
    expect(mocked.get).toHaveBeenCalledTimes(5);
    expect(results[0].metrics).toEqual({ views: 6, reach: 6, likes: 6, comments: 6, shares: 6 });
  });

  it("explains that partner access is required", async () => {
    client();
    mocked.get.mockRejectedValue(httpError(403));
    const { results } = await new LinkedInPublisher(options).getPostAnalytics([{ postId: "urn:li:share:1" }]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        status: "missing_permission",
        message: expect.stringContaining("Community Management"),
      }),
    );
  });
});

describe("Telegram analytics", () => {
  const options = { telegram: { chatId: "@channel", credentials: { botToken: "123:secret" } } };

  it("does not support post analytics", async () => {
    client();
    const { results } = await new TelegramPublisher(options).getPostAnalytics([{ postId: "5" }]);
    expect(results[0].status).toBe("unsupported");
  });

  it("reads the member count without leaking the bot token", async () => {
    const api = client();
    api.get.mockResolvedValueOnce({ data: { ok: true, result: 1234 } });
    const publisher = new TelegramPublisher(options);
    const ok = await publisher.getAccountAnalytics();
    expect(ok.metrics).toEqual({ followers: 1234 });

    api.get.mockRejectedValueOnce(httpError(400, { description: "chat not found for bot123:secret" }));
    const failed = await publisher.getAccountAnalytics();
    expect(failed.status).toBe("missing_permission");
    expect(failed.message).not.toContain("secret");
  });
});
