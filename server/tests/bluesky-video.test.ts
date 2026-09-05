import {
  hydrateRemoteMediaSizesForAccounts,
  post,
  PostErrorType,
  prepareMedia,
  validationRequestSchema,
} from "@simple-post/sdk";

import { getAccountsByIds } from "../src/config/accounts.js";
import { postToAccounts } from "../src/services/posting.js";
import { validatePostForAccounts } from "../src/services/validation.js";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  hydrateRemoteMediaSizesForAccounts: jest.fn(),
  post: jest.fn(),
  prepareMedia: jest.fn(),
}));
jest.mock("../src/config/accounts.js", () => ({ getAccountsByIds: jest.fn() }));
jest.mock("../src/services/uploads.js", () => ({ rewriteOwnUrlToPath: (url: string) => ({ kind: "url", url }) }));

const video = {
  id: "video",
  type: "video" as const,
  url: "https://cdn.example.com/video.mp4",
  filename: "video.mp4",
  size: 1024,
  durationSec: 60,
};
const account = {
  id: "bsky",
  platform: "bluesky" as const,
  rawPlatform: "bluesky",
  platformAccountId: "did:plc:user",
  credentials: { accessToken: "token", did: "did:plc:user", pdsUrl: "https://bsky.social" },
};
const cleanup = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getAccountsByIds).mockReturnValue([account]);
  jest.mocked(hydrateRemoteMediaSizesForAccounts).mockResolvedValue([]);
  jest.mocked(prepareMedia).mockImplementation(async (input) => ({ post: input, cleanup }));
  jest
    .mocked(post)
    .mockResolvedValue(
      new Map([["bluesky", { error: PostErrorType.NO_ERROR, id: "at://did:plc:user/app.bsky.feed.post/video" }]])
    );
});

it("accepts the HTTP video request and reports the SDK's video capabilities", async () => {
  const input = validationRequestSchema.parse({ accountIds: ["bsky"], media: [video] });
  const result = await validatePostForAccounts(input);
  expect(result.summary.isValid).toBe(true);
  expect(result.results[0].rules).toMatchObject({
    media: { maxVideos: 1, allowsMixed: false },
    video: { maxSizeBytes: 300_000_000, maxDurationSec: 600 },
  });
});

it.each([
  [[{ ...video, size: 300_000_001 }], "video_too_large"],
  [[{ ...video, durationSec: 601 }], "video_too_long"],
  [[video, video], "too_many_videos"],
  [
    [video, { ...video, type: "image" as const, url: "https://cdn.example.com/image.jpg" }],
    "mixed_media_not_supported",
  ],
])("rejects unsupported API video inputs %j", async (media, code) => {
  const result = await validatePostForAccounts({ message: "", media, accountIds: ["bsky"] });
  expect(result.summary.errors).toContainEqual(expect.objectContaining({ code }));
});

it("passes video media and credentials to the SDK and cleans prepared media", async () => {
  const results = await postToAccounts("Demo", [video], ["bsky"]);
  expect(results[0]).toMatchObject({ success: true, platform: "bluesky" });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      platforms: ["bluesky"],
      content: {
        text: "Demo",
        media: [expect.objectContaining({ type: "video", url: video.url, durationSec: 60, size: 1024 })],
      },
      options: { bluesky: { credentials: account.credentials } },
    })
  );
  expect(cleanup).toHaveBeenCalledTimes(1);
});
