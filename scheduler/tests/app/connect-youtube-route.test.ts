import { NextRequest } from "next/server";

import { GET } from "@/app/api/connect/[platform]/route";
import { hasFeature, requireSocialInbox } from "@/lib/features";
import { withAnalyticsScopes } from "@/lib/post-analytics/permissions";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/utils/errors";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn(), requireSocialInbox: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findFirst: jest.fn() } } }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_error" }));
jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: () => true }));
jest.mock("@/lib/oauth", () => ({
  getPlatformOAuthConfig: (platform: string, analytics: boolean) => ({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: "google-client",
    scope: analytics
      ? withAnalyticsScopes(
          platform,
          "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
        )
      : "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
    responseType: "code",
    requiresPkce: false,
  }),
  createOAuthState: () => "signed-state",
}));

it("requests account selection and consent while retaining offline access and state", async () => {
  const response = await GET(new NextRequest("https://app.simplepost.social/api/connect/youtube"), {
    params: Promise.resolve({ platform: "youtube" }),
  });

  expect(response.status).toBe(307);
  const url = new URL(response.headers.get("location")!);
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("prompt")?.split(" ").sort()).toEqual(["consent", "select_account"]);
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("state")).toBe("signed-state");
  expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/connect\/callback\/youtube$/);
});

it.each([false, true])("includes the configured analytics scope only for a granted user (%s)", async (granted) => {
  const previous = process.env.OAUTH_ANALYTICS_SCOPES;
  try {
    process.env.OAUTH_ANALYTICS_SCOPES = "youtube";
    jest.mocked(hasFeature).mockResolvedValue(granted);
    const response = await GET(new NextRequest("https://app.simplepost.social/api/connect/youtube"), {
      params: Promise.resolve({ platform: "youtube" }),
    });
    const scopes = new URL(response.headers.get("location")!).searchParams.get("scope")!.split(" ");
    expect(hasFeature).toHaveBeenCalledWith("user-1", "POST_ANALYTICS");
    expect(scopes.includes("https://www.googleapis.com/auth/yt-analytics.readonly")).toBe(granted);
    expect(scopes).not.toContain("https://www.googleapis.com/auth/youtube.force-ssl");
  } finally {
    if (previous === undefined) delete process.env.OAUTH_ANALYTICS_SCOPES;
    else process.env.OAUTH_ANALYTICS_SCOPES = previous;
  }
});

describe("YouTube inbox consent alongside analytics", () => {
  const originalEnv = process.env;
  const inboxRequest = new NextRequest("https://app.simplepost.social/api/connect/youtube?inboxAccountId=account-1");
  const params = { params: Promise.resolve({ platform: "youtube" }) };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      OAUTH_ANALYTICS_SCOPES: "youtube",
      SOCIAL_INBOX_OAUTH_PLATFORMS: "youtube",
    };
    jest.mocked(requireSocialInbox).mockResolvedValue(undefined);
    jest.mocked(prisma.connectedAccount.findFirst).mockResolvedValue({ id: "account-1" } as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([false, true])("keeps the inbox and analytics scopes independent (analytics=%s)", async (analytics) => {
    jest.mocked(hasFeature).mockResolvedValue(analytics);
    const response = await GET(inboxRequest, params);
    expect(response.status).toBe(307);
    const scopes = new URL(response.headers.get("location")!).searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      ...(analytics ? ["https://www.googleapis.com/auth/yt-analytics.readonly"] : []),
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ]);
    expect(requireSocialInbox).toHaveBeenCalledWith("user-1");
    expect(prisma.connectedAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "account-1", userId: "user-1", platform: "youtube" },
      select: { id: true },
    });
  });

  it("rejects inbox consent for an analytics-only user", async () => {
    jest.mocked(hasFeature).mockResolvedValue(true);
    jest.mocked(requireSocialInbox).mockRejectedValue(new ForbiddenError("Social inbox is not enabled"));

    const response = await GET(inboxRequest, params);

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(prisma.connectedAccount.findFirst).not.toHaveBeenCalled();
  });
});
