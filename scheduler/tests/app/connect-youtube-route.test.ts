import { NextRequest } from "next/server";

import { GET } from "@/app/api/connect/[platform]/route";
import { hasFeature } from "@/lib/features";
import { withAnalyticsScopes } from "@/lib/post-analytics/permissions";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn() }));
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
  } finally {
    if (previous === undefined) delete process.env.OAUTH_ANALYTICS_SCOPES;
    else process.env.OAUTH_ANALYTICS_SCOPES = previous;
  }
});
