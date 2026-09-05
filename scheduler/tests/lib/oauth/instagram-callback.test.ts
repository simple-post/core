import { authLogger } from "@/lib/logger";
import { handleInstagramCallback } from "@/lib/oauth/callbacks/instagram";
import { mapErrorToCode, OAuthCallbackError } from "@/lib/oauth/errors";
import { exchangeCodeForToken } from "@/lib/oauth/token-exchange";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/logger", () => ({ authLogger: { error: jest.fn(), info: jest.fn() } }));
jest.mock("@/lib/oauth/config", () => ({
  getPlatformOAuthConfig: () => ({
    clientId: "app-id",
    clientSecret: "secret",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
  }),
}));
jest.mock("@/lib/oauth/upsert", () => ({ upsertConnectedAccount: jest.fn() }));
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const context = {
  userId: "user-1",
  platform: "instagram",
  baseURL: "https://app.simplepost.social",
  tokenData: { access_token: "short", user_id: "123" },
  accessToken: "short",
  refreshToken: null,
  expiresIn: undefined,
  scope: "instagram_business_basic,instagram_business_content_publish",
  tokenMetadata: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => {
  global.fetch = originalFetch;
});

it.each([
  { access_token: "short", user_id: "123" },
  { data: [{ access_token: "short", user_id: "123", permissions: ["instagram_business_basic"] }] },
])("accepts flat and enveloped Instagram tokens", async (body) => {
  fetchMock.mockResolvedValue(response(body));
  expect(await exchangeCodeForToken("instagram", "code", "https://app.simplepost.social/callback")).toMatchObject({
    access_token: "short",
    user_id: "123",
  });
});
it("stores an Instagram account after exchanging the token and fetching identity", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ access_token: "long", expires_in: 1000 }))
    .mockResolvedValueOnce(response({ user_id: "123", username: "creator", name: "Creator" }));
  const result = await handleInstagramCallback(context);
  expect(result.headers.get("location")).toContain("success=true&platform=instagram");
  expect(upsertConnectedAccount).toHaveBeenCalledWith(
    expect.objectContaining({ platformAccountId: "123", accessToken: "long", username: "creator" }),
  );
  expect(fetchMock.mock.calls[1][0]).not.toContain("access_token");
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer long");
});
it("retries minimal identity fields when optional profile fields are rejected", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ access_token: "long" }))
    .mockResolvedValueOnce(response({ error: { code: 100, message: "Unsupported field" } }, 400))
    .mockResolvedValueOnce(response({ user_id: "123", username: "creator" }));
  await handleInstagramCallback(context);
  expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get("fields")).toBe("user_id,username");
  expect(upsertConnectedAccount).toHaveBeenCalled();
});
it("does not connect rejected tokens and records safe provider diagnostics", async () => {
  fetchMock.mockResolvedValue(
    response({ error: { code: 190, message: "Invalid token", access_token: "do-not-log" } }, 400),
  );
  await expect(handleInstagramCallback(context)).rejects.toMatchObject({ code: "token_exchange_failed" });
  expect(authLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({ providerError: expect.objectContaining({ code: 190 }) }),
    expect.any(String),
  );
  expect(JSON.stringify((authLogger.error as jest.Mock).mock.calls)).not.toContain("do-not-log");
  expect(upsertConnectedAccount).not.toHaveBeenCalled();
});
it("rejects a missing account ID instead of saving an unusable connection", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ access_token: "long" }))
    .mockResolvedValueOnce(response({ username: "creator" }));
  await expect(handleInstagramCallback(context)).rejects.toMatchObject({ code: "profile_fetch_failed" });
  expect(upsertConnectedAccount).not.toHaveBeenCalled();
});
it("maps an expired session and provider failures to actionable errors", () => {
  expect(mapErrorToCode(new UnauthorizedError("Authentication required"))).toBe("session_mismatch");
  expect(mapErrorToCode(new OAuthCallbackError("profile_fetch_failed", "No profile"))).toBe("profile_fetch_failed");
});
