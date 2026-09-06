import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { getYouTubeLibrary, getYouTubeVideo } from "@/lib/youtube/readback";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findFirst: jest.fn() } } }));
jest.mock("@/lib/oauth/credential-health", () => ({ refreshConnectedAccountIfNeeded: jest.fn() }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: (value: unknown) => value,
}));

const lookup = prisma.connectedAccount.findFirst as jest.Mock;
const refresh = refreshConnectedAccountIfNeeded as jest.Mock;
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const account = {
  id: "account",
  userId: "owner",
  platform: "youtube",
  platformAccountId: "google-sub-not-channel",
  accessToken: "private-token",
};
const video = {
  id: "abcdefghijk",
  snippet: { channelId: "UC-owner", title: "Provider title" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
  fileDetails: { fileSize: "12345", durationMs: "4000", videoStreams: [{ widthPixels: 1080, heightPixels: 1920 }] },
  processingDetails: { processingStatus: "succeeded" },
};
function response(items: unknown[]) {
  return { ok: true, json: async () => ({ items }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  lookup.mockResolvedValue(account);
  refresh.mockResolvedValue({ account });
});
afterAll(() => {
  global.fetch = originalFetch;
});

it("does not refresh or call the provider for an account outside the current user", async () => {
  lookup.mockResolvedValue(null);
  await expect(getYouTubeLibrary("other-user", "account")).rejects.toThrow("Account not found");
  expect(lookup).toHaveBeenCalledWith({ where: { id: "account", userId: "other-user" } });
  expect(refresh).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("discovers channel IDs via YouTube rather than the stored Google subject", async () => {
  fetchMock
    .mockResolvedValueOnce(response([{ id: "UC-owner", snippet: { title: "Owner" } }]))
    .mockResolvedValueOnce(response([{ id: "playlist", snippet: { title: "Tests", channelId: "UC-owner" } }]));
  expect(await getYouTubeLibrary("owner", "account")).toEqual({
    channels: [{ id: "UC-owner", title: "Owner" }],
    playlists: [{ id: "playlist", title: "Tests" }],
    nextPageToken: undefined,
  });
});
it("reads actual provider status without exposing credentials", async () => {
  fetchMock.mockResolvedValueOnce(response([{ id: "UC-owner" }])).mockResolvedValueOnce(response([video]));
  const result = await getYouTubeVideo("owner", "account", video.id);
  expect(result).toEqual({ video });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("part")).toBe(
    "snippet,status,contentDetails,fileDetails,processingDetails",
  );
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store", redirect: "error" });
});
it("rejects videos from another channel even when publicly readable", async () => {
  fetchMock.mockResolvedValueOnce(response([{ id: "UC-other" }])).mockResolvedValueOnce(response([video]));
  await expect(getYouTubeVideo("owner", "account", video.id)).rejects.toThrow("Video not found");
});
it("rejects unrelated playlists before fetching their contents", async () => {
  fetchMock
    .mockResolvedValueOnce(response([{ id: "UC-owner" }]))
    .mockResolvedValueOnce(response([video]))
    .mockResolvedValueOnce(response([{ id: "playlist", snippet: { channelId: "UC-other" } }]));
  await expect(getYouTubeVideo("owner", "account", video.id, "playlist")).rejects.toThrow("Playlist not found");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("does not echo credential-bearing upstream error bodies", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "private-token" }) });
  await expect(getYouTubeLibrary("owner", "account")).rejects.toThrow("YouTube readback failed (403)");
});
it("rejects malformed resource IDs before network activity", async () => {
  await expect(getYouTubeVideo("owner", "account", "../tokens")).rejects.toThrow("Invalid YouTube video ID");
  expect(fetchMock).not.toHaveBeenCalled();
});
