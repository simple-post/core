import { NextRequest } from "next/server";

import { GET } from "@/app/api/connect/[platform]/route";
import { hasFeature, requireSocialInbox } from "@/lib/features";
import { createOAuthState } from "@/lib/oauth";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/utils/errors";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn(), requireSocialInbox: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findFirst: jest.fn() } } }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_error" }));
jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: () => true }));
jest.mock("@/lib/oauth", () => {
  const config = jest.requireActual<typeof import("@/lib/oauth/config")>("@/lib/oauth/config");
  return {
    getPlatformOAuthConfig: (platform: string) => ({ ...config.getPlatformOAuthConfig(platform), clientId: "client" }),
    createOAuthState: jest.fn(() => "signed-state"),
    generatePkce: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
    setPkceCookie: jest.fn(),
  };
});

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

it.each([false, true])("requests analytics without inbox scopes for an analytics grant (%s)", async (granted) => {
  const previous = process.env.OAUTH_ANALYTICS_SCOPES;
  try {
    process.env.OAUTH_ANALYTICS_SCOPES = "youtube";
    jest.mocked(hasFeature).mockImplementation(async (_user, feature) => granted && feature === "POST_ANALYTICS");
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

describe("default pilot OAuth scopes", () => {
  const originalEnv = process.env;
  const pilotScopes = [
    [
      "youtube",
      ["https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"],
    ],
    ["threads", ["threads_manage_insights", "threads_read_replies"]],
    ["facebook", ["read_insights", "pages_read_user_content", "pages_manage_engagement"]],
    ["instagram", ["instagram_business_manage_insights", "instagram_business_manage_comments"]],
    ["tiktok", ["video.list", "user.info.stats"]],
    ["x", ["like.read", "like.write"]],
    ["bluesky", []],
    ["linkedin", []],
  ] as const;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OAUTH_ANALYTICS_SCOPES;
    delete process.env.SOCIAL_INBOX_OAUTH_PLATFORMS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.each(pilotScopes)("adds the expected scopes on %s only with grants", async (platform, extra) => {
    const base = getPlatformOAuthConfig(platform)!.scope;
    const request = new NextRequest(`https://app.simplepost.social/api/connect/${platform}`);
    const params = { params: Promise.resolve({ platform }) };
    for (const granted of [false, true]) {
      jest.mocked(hasFeature).mockResolvedValue(granted);
      const response = await GET(request, params);
      expect(response.status).toBe(307);
      const scope = new URL(response.headers.get("location")!).searchParams.get("scope");
      const separator = base.includes(",") ? "," : " ";
      expect(scope).toBe(granted ? [...base.split(separator), ...extra].join(separator) : base);
      if (granted && extra.length > 0) {
        expect(createOAuthState).toHaveBeenLastCalledWith(
          "user-1",
          platform,
          undefined,
          undefined,
          expect.objectContaining({ scope }),
          { workspaceId: undefined, reconnectAccountId: undefined },
        );
      }
    }
  });

  it("honors explicit empty settings for both sets of scopes", async () => {
    process.env.OAUTH_ANALYTICS_SCOPES = "";
    process.env.SOCIAL_INBOX_OAUTH_PLATFORMS = "";
    jest.mocked(hasFeature).mockResolvedValue(true);
    const response = await GET(new NextRequest("https://app.simplepost.social/api/connect/youtube"), {
      params: Promise.resolve({ platform: "youtube" }),
    });
    expect(new URL(response.headers.get("location")!).searchParams.get("scope")).toBe(
      getPlatformOAuthConfig("youtube")?.scope,
    );
  });
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
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      ...(analytics ? ["https://www.googleapis.com/auth/yt-analytics.readonly"] : []),
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ]);
    expect(requireSocialInbox).toHaveBeenCalledWith("user-1");
    expect(prisma.connectedAccount.findFirst).toHaveBeenCalledWith({
      where: { id: "account-1", userId: "user-1", platform: "youtube", workspaceId: null },
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
