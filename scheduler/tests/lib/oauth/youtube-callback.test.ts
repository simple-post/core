import { handleYouTubeCallback } from "@/lib/oauth/callbacks/youtube";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { getErrorRedirectUrl, mapErrorToCode } from "@/lib/oauth/errors";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

jest.mock("@/lib/oauth/upsert", () => ({ upsertConnectedAccount: jest.fn() }));
jest.mock("@/lib/oauth/credential-health", () => ({ refreshConnectedAccountIfNeeded: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));

const fetchMock = jest.fn();
const originalFetch = global.fetch;
const findManyMock = prisma.connectedAccount.findMany as jest.Mock;
const refreshMock = refreshConnectedAccountIfNeeded as jest.Mock;
const upsertMock = upsertConnectedAccount as jest.Mock;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const channel = (id = "UC-brand") => ({
  id,
  snippet: {
    title: "Brand Channel",
    customUrl: "@brand",
    thumbnails: { high: { url: "https://example.com/brand.jpg" } },
  },
});
const context = {
  userId: "user-1",
  platform: "youtube",
  baseURL: "https://app.simplepost.social",
  tokenData: { access_token: "new-token" },
  accessToken: "new-token",
  refreshToken: "new-refresh",
  expiresIn: 3600,
  scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload",
  tokenMetadata: { refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z" },
};
const legacy = {
  id: "existing-account",
  userId: "user-1",
  platform: "youtube",
  platformAccountId: "1234567890",
  accessToken: "old-token",
  refreshToken: "old-refresh",
  tokenMetadata: null,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock;
  findManyMock.mockResolvedValue([]);
  refreshMock.mockImplementation(async (account) => ({ account }));
});
afterAll(() => {
  global.fetch = originalFetch;
});

it("stores the authorized Brand channel identity and credentials without a Google profile lookup", async () => {
  fetchMock.mockResolvedValue(response({ items: [channel()] }));
  const result = await handleYouTubeCallback(context);

  expect(result.headers.get("location")).toContain("success=true&platform=youtube");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=2",
    expect.objectContaining({ headers: { Authorization: "Bearer new-token" }, cache: "no-store" }),
  );
  expect(findManyMock).toHaveBeenCalledWith({ where: { userId: "user-1", platform: "youtube" } });
  expect(upsertMock).toHaveBeenCalledWith({
    userId: "user-1",
    platform: "youtube",
    platformAccountId: "UC-brand",
    displayName: "Brand Channel",
    username: "brand",
    profilePicture: "https://example.com/brand.jpg",
    email: null,
    accessToken: "new-token",
    refreshToken: "new-refresh",
    expiresAt: expect.any(Date),
    scope: context.scope,
    tokenMetadata: context.tokenMetadata,
  });
});

it("stores personal and Brand channels as separate accounts and reconnects by channel ID", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ items: [channel("UC-personal")] }))
    .mockResolvedValueOnce(response({ items: [channel("UC-brand")] }))
    .mockResolvedValueOnce(response({ items: [channel("UC-brand")] }));
  await handleYouTubeCallback(context);
  await handleYouTubeCallback(context);
  findManyMock.mockResolvedValue([{ ...legacy, platformAccountId: "UC-brand" }]);
  await handleYouTubeCallback(context);

  expect(upsertMock.mock.calls.map(([data]) => data.platformAccountId)).toEqual([
    "UC-personal",
    "UC-brand",
    "UC-brand",
  ]);
  expect(refreshMock).not.toHaveBeenCalled();
});

it("preserves a legacy connection only after its own refreshed credentials prove the same channel", async () => {
  findManyMock.mockResolvedValue([encryptConnectedAccountSecrets(legacy)]);
  const refreshedAt = new Date("2026-10-26T00:00:00Z");
  refreshMock.mockResolvedValue({ account: { ...legacy, accessToken: "refreshed-old", updatedAt: refreshedAt } });
  fetchMock
    .mockResolvedValueOnce(response({ items: [channel()] }))
    .mockResolvedValueOnce(response({ items: [channel()] }));
  await handleYouTubeCallback(context);

  expect(refreshMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "old-token" }));
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer refreshed-old");
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({
      platformAccountId: "UC-brand",
      previousIdentity: { platformAccountId: legacy.platformAccountId, updatedAt: refreshedAt },
    }),
  );
});

it.each(["different-channel", "revoked", "lookup-failed"])(
  "leaves the old connection untouched when its channel is %s",
  async (scenario) => {
    findManyMock.mockResolvedValue([encryptConnectedAccountSecrets(legacy)]);
    fetchMock.mockResolvedValueOnce(response({ items: [channel()] }));
    if (scenario === "revoked") {
      refreshMock.mockResolvedValue({ account: legacy, error: "Reconnect required" });
    } else if (scenario === "lookup-failed") {
      fetchMock.mockResolvedValueOnce(response({ error: "expired" }, 401));
    } else {
      fetchMock.mockResolvedValueOnce(response({ items: [channel("UC-personal")] }));
    }
    await handleYouTubeCallback(context);

    expect(upsertMock.mock.calls[0][0]).not.toHaveProperty("previousIdentity");
    expect(upsertMock.mock.calls[0][0].platformAccountId).toBe("UC-brand");
  },
);

it.each([
  [{ items: [] }, "youtube_no_channel"],
  [{}, "youtube_no_channel"],
  [{ items: [{}] }, "profile_fetch_failed"],
  [{ items: [{ id: 42 }] }, "profile_fetch_failed"],
  [{ items: [channel(), channel("UC-other")] }, "youtube_ambiguous_channel"],
  [{ items: [channel()], nextPageToken: "more" }, "youtube_ambiguous_channel"],
])("rejects missing or ambiguous channel identity without saving credentials: %j", async (body, code) => {
  fetchMock.mockResolvedValue(response(body));
  await expect(handleYouTubeCallback(context)).rejects.toMatchObject({ code });
  expect(upsertMock).not.toHaveBeenCalled();
  expect(findManyMock).not.toHaveBeenCalled();
});

it.each([401, 403, 500])("fails closed on a rejected channel lookup (%s)", async (status) => {
  fetchMock.mockResolvedValue(response({ error: { message: "provider-body-with-secret" } }, status));
  await expect(handleYouTubeCallback(context)).rejects.toMatchObject({
    code: "profile_fetch_failed",
    message: "Failed to fetch authorized YouTube channel",
  });
  expect(upsertMock).not.toHaveBeenCalled();
});

it("keeps network errors out of the callback error and maps no-channel failures to guidance", async () => {
  fetchMock.mockRejectedValue(new Error("URL with new-token"));
  await expect(handleYouTubeCallback(context)).rejects.toThrow("Failed to fetch authorized YouTube channel");
  fetchMock.mockResolvedValue(response({ items: [] }));
  try {
    await handleYouTubeCallback(context);
  } catch (error) {
    expect(decodeURIComponent(getErrorRedirectUrl(mapErrorToCode(error), context.baseURL))).toContain(
      "select the Google account or Brand Account that owns your channel",
    );
  }
});

it("accepts a channel without optional profile fields", async () => {
  fetchMock.mockResolvedValue(response({ items: [{ id: "UC-personal" }] }));
  await handleYouTubeCallback(context);
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({
      platformAccountId: "UC-personal",
      displayName: null,
      username: null,
      profilePicture: null,
    }),
  );
});
