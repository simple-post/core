import { getAccountPlatformConfig } from "../../src/lib/account/platforms.js";
import { buildAuthorizationUrl, resolveOAuthAppInputs } from "../../src/lib/auth/oauth.js";
import { YouTubeAuthProvider } from "../../src/lib/auth/youtube.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";

import type { AuthProviderContext } from "../../src/lib/auth/provider.js";

const fetchMock = jest.fn();
const originalFetch = global.fetch;
const writeSecret = jest.fn();
let secretIndex = 0;
const originalClientId = process.env.SIMPLE_POST_YOUTUBE_CLIENT_ID;
const originalClientSecret = process.env.SIMPLE_POST_YOUTUBE_CLIENT_SECRET;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = { access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 };
const channel = (id: string, name: string) => ({ id, snippet: { title: name, customUrl: `@${name}` } });
const provider = new YouTubeAuthProvider({
  createState: () => "state-1",
  createAccountSecretRef: () => `secret-${++secretIndex}`,
  resolveCallbackUrl: async () => "http://127.0.0.1:5000/oauth/callback?code=code-1&state=state-1",
});
const flags = { alias: "brand" };

function context(): AuthProviderContext {
  return {
    config: createEmptyCliConfig(),
    prompt: { interactive: false, log: jest.fn() },
    secretStore: { write: writeSecret },
  } as unknown as AuthProviderContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  secretIndex = 0;
  process.env.SIMPLE_POST_YOUTUBE_CLIENT_ID = "google-client";
  process.env.SIMPLE_POST_YOUTUBE_CLIENT_SECRET = "google-secret";
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalClientId === undefined) delete process.env.SIMPLE_POST_YOUTUBE_CLIENT_ID;
  else process.env.SIMPLE_POST_YOUTUBE_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.SIMPLE_POST_YOUTUBE_CLIENT_SECRET;
  else process.env.SIMPLE_POST_YOUTUBE_CLIENT_SECRET = originalClientSecret;
});

it("prompts for account selection and consent with offline access and PKCE", () => {
  const appConfig = resolveOAuthAppInputs("youtube", flags, getAccountPlatformConfig("youtube").oauthApp!);
  const url = new URL(buildAuthorizationUrl({ appConfig, state: "state-1", codeChallenge: "pkce" }));
  expect(url.searchParams.get("prompt")).toBe("consent select_account");
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("state")).toBe("state-1");
  expect(url.searchParams.get("code_challenge")).toBe("pkce");
});

it("stores the authorized channel ID and handle instead of a Google profile", async () => {
  fetchMock
    .mockResolvedValueOnce(response(token))
    .mockResolvedValueOnce(response({ items: [channel("UC-brand", "Brand")] }));
  const result = await provider.login(flags, context());

  expect(result.youtube.accounts[0]).toMatchObject({
    userId: "UC-brand",
    displayName: "Brand",
    username: "Brand",
    alias: "brand",
  });
  expect(fetchMock.mock.calls[1][0]).toBe(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=2",
  );
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer access-token");
  expect(writeSecret).toHaveBeenCalledWith(
    "youtube-account-secret-1",
    expect.objectContaining({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    }),
  );
});

it("keeps channels separate and reconnects the same channel without duplicating it", async () => {
  const ctx = context();
  for (const [id, alias] of [
    ["UC-personal", "personal"],
    ["UC-brand", "brand"],
    ["UC-brand", "brand"],
  ]) {
    fetchMock.mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response({ items: [channel(id, alias)] }));
    ctx.config = await provider.login({ ...flags, alias }, ctx);
  }
  expect(ctx.config.youtube.accounts.map((account) => account.userId).sort()).toEqual(["UC-brand", "UC-personal"]);
  expect(new Set(ctx.config.youtube.accounts.map((account) => account.secretRef)).size).toBe(2);
});

it.each([
  [{ items: [] }, "No YouTube channel was authorized"],
  [{ items: [{}] }, "did not return a channel ID"],
  [{ items: [{ id: 42 }] }, "did not return a channel ID"],
  [{ items: [channel("UC-a", "A"), channel("UC-b", "B")] }, "single YouTube channel"],
  [{ items: [channel("UC-a", "A")], nextPageToken: "next" }, "single YouTube channel"],
])("rejects missing or ambiguous channel identity: %j", async (body, message) => {
  fetchMock.mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response(body));
  await expect(provider.login(flags, context())).rejects.toThrow(message);
  expect(writeSecret).not.toHaveBeenCalled();
});

it("does not save credentials when the channel lookup fails", async () => {
  fetchMock.mockResolvedValueOnce(response(token)).mockResolvedValueOnce(response({ error: "Forbidden" }, 403));
  await expect(provider.login(flags, context())).rejects.toThrow("YouTube channel lookup failed (403)");
  expect(writeSecret).not.toHaveBeenCalled();
});
