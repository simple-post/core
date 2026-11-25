import {
  accountAnalyticsReadiness,
  analyticsAccountReadiness,
  withAnalyticsScopes,
} from "@/lib/post-analytics/permissions";

describe("analytics permissions", () => {
  const original = process.env.OAUTH_ANALYTICS_SCOPES;
  afterEach(() => {
    if (original === undefined) delete process.env.OAUTH_ANALYTICS_SCOPES;
    else process.env.OAUTH_ANALYTICS_SCOPES = original;
  });

  it("requests analytics scopes only for enabled platforms", () => {
    delete process.env.OAUTH_ANALYTICS_SCOPES;
    expect(withAnalyticsScopes("threads", "threads_basic,threads_content_publish")).toBe(
      "threads_basic,threads_content_publish,threads_manage_insights",
    );
    process.env.OAUTH_ANALYTICS_SCOPES = "threads, tiktok";
    expect(withAnalyticsScopes("threads", "threads_basic,threads_content_publish")).toBe(
      "threads_basic,threads_content_publish,threads_manage_insights",
    );
    expect(withAnalyticsScopes("tiktok", "video.upload,video.publish")).toContain("video.list,user.info.stats");
    expect(withAnalyticsScopes("facebook", "public_profile,pages_show_list")).not.toContain("read_insights");
    process.env.OAUTH_ANALYTICS_SCOPES = "all";
    expect(withAnalyticsScopes("linkedin", "openid profile")).toBe(
      "openid profile r_member_postAnalytics r_member_profileAnalytics",
    );
    expect(withAnalyticsScopes("x", "tweet.read")).toBe("tweet.read");
  });

  it("reports missing required scopes with a reconnect hint when the installation requests them", () => {
    process.env.OAUTH_ANALYTICS_SCOPES = "tiktok";
    expect(analyticsAccountReadiness({ platform: "tiktok", scope: "video.publish,video.upload" })).toEqual(
      expect.objectContaining({
        ready: false,
        status: "missing_permission",
        missingScopes: ["video.list"],
        reconnectRecommended: true,
      }),
    );
    process.env.OAUTH_ANALYTICS_SCOPES = "";
    expect(analyticsAccountReadiness({ platform: "tiktok", scope: "video.publish" })).toEqual(
      expect.objectContaining({ ready: false, reconnectRecommended: false }),
    );
  });

  it("attempts unknown grants and degrades gracefully for optional insights", () => {
    expect(analyticsAccountReadiness({ platform: "threads", scope: null }).ready).toBe(true);
    process.env.OAUTH_ANALYTICS_SCOPES = "instagram";
    expect(
      analyticsAccountReadiness({
        platform: "instagram",
        scope: "instagram_business_basic,instagram_business_content_publish",
      }),
    ).toEqual(
      expect.objectContaining({
        ready: true,
        reconnectRecommended: true,
        missingScopes: ["instagram_business_manage_insights"],
      }),
    );
    expect(
      analyticsAccountReadiness({ platform: "instagram", scope: "instagram_basic,instagram_manage_insights" }),
    ).toEqual(expect.objectContaining({ ready: true, reconnectRecommended: false, missingScopes: [] }));
  });

  it("marks Telegram posts and preview accounts as unsupported", () => {
    expect(analyticsAccountReadiness({ platform: "telegram", scope: null })).toEqual(
      expect.objectContaining({ ready: false, status: "unsupported" }),
    );
    expect(analyticsAccountReadiness({ platform: "x", scope: null, tokenMetadata: { previewOnly: true } }).ready).toBe(
      false,
    );
    expect(accountAnalyticsReadiness({ platform: "telegram", scope: null }).ready).toBe(true);
    expect(accountAnalyticsReadiness({ platform: "tiktok", scope: "video.list" }).ready).toBe(false);
  });
});
