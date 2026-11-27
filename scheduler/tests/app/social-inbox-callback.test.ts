import { NextRequest, NextResponse } from "next/server";

import { GET } from "@/app/api/connect/callback/[platform]/route";
import { hasFeature, requireSocialInbox } from "@/lib/features";
import { exchangeCodeForToken, handlePlatformCallback, verifyOAuthState } from "@/lib/oauth";
import { OAuthCallbackError } from "@/lib/oauth/errors";

jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_error" }));
jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: () => true }));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn(), requireSocialInbox: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { connectedAccount: { findFirst: async () => ({ platformAccountId: "123" }) } },
}));
jest.mock("@/lib/oauth", () => ({
  ...jest.requireActual("@/lib/oauth"),
  verifyOAuthState: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  handlePlatformCallback: jest.fn(),
}));

const previous = process.env.SOCIAL_INBOX_OAUTH_PLATFORMS;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_INBOX_OAUTH_PLATFORMS = "threads,instagram";
});

describe("pilot scope callback", () => {
  const requested = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ].join(" ");

  function pilotCallback() {
    return GET(new NextRequest("http://localhost/api/connect/callback/youtube?code=code&state=signed"), {
      params: Promise.resolve({ platform: "youtube" }),
    });
  }

  beforeEach(() => {
    jest.mocked(hasFeature).mockResolvedValue(true);
    jest.mocked(verifyOAuthState).mockReturnValue({
      userId: "user-1",
      platform: "youtube",
      timestamp: Date.now(),
      pilotScopes: { scope: requested, analytics: true, inbox: true },
    });
    jest.mocked(handlePlatformCallback).mockResolvedValue(new NextResponse(null));
  });

  it.each([undefined, "https://www.googleapis.com/auth/youtube.readonly"])(
    "uses the provider scope when present and the signed request when omitted (%s)",
    async (scope) => {
      jest.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "test", scope });
      await pilotCallback();
      expect(requireSocialInbox).toHaveBeenCalledWith("user-1");
      expect(handlePlatformCallback).toHaveBeenCalledWith(expect.objectContaining({ scope: scope ?? requested }));
    },
  );

  it("rejects a pilot callback if its Analytics grant was revoked during consent", async () => {
    jest.mocked(hasFeature).mockResolvedValue(false);
    const response = await pilotCallback();
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe(
      "Invalid authorization request. Please try connecting again.",
    );
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });
});
afterAll(() => {
  if (previous === undefined) delete process.env.SOCIAL_INBOX_OAUTH_PLATFORMS;
  else process.env.SOCIAL_INBOX_OAUTH_PLATFORMS = previous;
});
afterEach(() => jest.restoreAllMocks());

function callback(platform: string) {
  jest
    .mocked(verifyOAuthState)
    .mockReturnValue({ userId: "user-1", platform, inboxAccountId: "row", timestamp: Date.now() });
  return GET(new NextRequest("http://localhost/api/connect/callback/" + platform + "?code=code&state=signed"), {
    params: Promise.resolve({ platform }),
  });
}

it("preserves the Instagram connection when the grant list is missing", async () => {
  jest.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "test" });
  const response = await callback("instagram");
  expect(response.headers.get("location")).toContain("/inbox?connection=permissions");
  expect(handlePlatformCallback).not.toHaveBeenCalled();
});

it.each([false, true])("uses the inspected Threads grant for an inbox reconnect (complete: %s)", async (complete) => {
  const scopes = ["threads_basic", "threads_content_publish", "threads_manage_replies"];
  if (complete) scopes.push("threads_read_replies");
  jest.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "test" });
  const inspect = jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ data: { is_valid: true, scopes } }));
  jest.mocked(handlePlatformCallback).mockResolvedValue(new NextResponse(null));
  const response = await callback("threads");
  expect(new URL(String(inspect.mock.calls[0][0])).pathname).toBe("/debug_token");
  if (complete)
    expect(handlePlatformCallback).toHaveBeenCalledWith(
      expect.objectContaining({ scope: scopes.join(" "), inboxIdentity: "123" }),
    );
  else {
    expect(response.headers.get("location")).toContain("/inbox?connection=permissions");
    expect(handlePlatformCallback).not.toHaveBeenCalled();
  }
});

it.each([false, true])("adds the TikTok scope notice only for a signed pilot request (%s)", async (pilot) => {
  jest.mocked(verifyOAuthState).mockReturnValue({
    userId: "user-1",
    platform: "tiktok",
    timestamp: Date.now(),
    ...(pilot && { pilotScopes: { scope: "video.list", analytics: true, inbox: false } }),
  });

  const response = await GET(
    new NextRequest("http://localhost/api/connect/callback/tiktok?state=signed&error=invalid_scope"),
    { params: Promise.resolve({ platform: "tiktok" }) },
  );
  const { searchParams } = new URL(response.headers.get("location")!);
  expect(searchParams.get("scopeUnavailable")).toBe(pilot ? "tiktok" : null);
  expect(exchangeCodeForToken).not.toHaveBeenCalled();
});

it.each(["instagram", "threads"])(
  "passes the signed target to the Instagram mismatch dialog (%s)",
  async (platform) => {
    jest.mocked(verifyOAuthState).mockReturnValue({
      userId: "user-1",
      platform,
      reconnectAccountId: "original-connection",
      timestamp: Date.now(),
    });
    jest.mocked(exchangeCodeForToken).mockResolvedValue({ access_token: "test" });
    jest
      .mocked(handlePlatformCallback)
      .mockRejectedValueOnce(
        new OAuthCallbackError("reconnect_account_mismatch", "Choose the same account to reconnect."),
      );
    const response = await GET(
      new NextRequest(
        `http://localhost/api/connect/callback/${platform}?code=code&state=signed&instagramReconnect=other`,
      ),
      { params: Promise.resolve({ platform }) },
    );

    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/accounts");
    expect(destination.searchParams.get("error")).toBe("Choose the same account to reconnect.");
    expect(destination.searchParams.get("instagramReconnect")).toBe(
      platform === "instagram" ? "original-connection" : null,
    );
    expect(destination.searchParams.has("access_token")).toBe(false);
  },
);
