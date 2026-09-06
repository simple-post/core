import { inspectRemoteMedia } from "../src/utils/media-inspection";
import { hydrateRemoteMediaSizesForAccounts } from "../src/utils/remote-media-validation";
import { getValidationRulesForPlatform, validateContentForPlatform } from "../src/validation";

import type { MediaFile } from "../src/types/api";
import type { Content } from "../src/types/post";

jest.mock("../src/utils/media-inspection", () => ({
  ...jest.requireActual("../src/utils/media-inspection"),
  inspectRemoteMedia: jest.fn(),
}));

const inspectRemoteMediaMock = inspectRemoteMedia as jest.MockedFunction<typeof inspectRemoteMedia>;

function mediaFile(type: "image" | "video", url?: string, size = 0): MediaFile {
  const extension = type === "image" ? "png" : "mp4";
  return {
    id: `media-${type}`,
    url: url ?? `https://cdn.example.com/media.${extension}`,
    type,
    filename: `media.${extension}`,
    size,
  };
}

function contentFrom(media: MediaFile[]): Content {
  return {
    text: "Hello",
    media: media.map((item) =>
      item.type === "image"
        ? { type: "image", url: item.url, size: item.size }
        : { type: "video", url: item.url, size: item.size, thumbnailUrl: item.thumbnailUrl },
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  inspectRemoteMediaMock.mockImplementation(async (url) => ({
    size: 1024,
    contentType: url.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
  }));
});

it("replaces unknown and stale caller sizes with the measured value", async () => {
  const unknown = mediaFile("image", "https://cdn.example.com/unknown.png", 0);
  const stale = mediaFile("image", "https://cdn.example.com/stale.png", 100);
  inspectRemoteMediaMock.mockResolvedValue({ size: 5_506_166, contentType: "image/jpeg" });

  await hydrateRemoteMediaSizesForAccounts({
    media: [unknown, stale],
    accounts: [{ id: "x-account", platform: "x" }],
  });

  expect(unknown.size).toBe(5_506_166);
  expect(stale.size).toBe(5_506_166);
});

it("applies X's separate animated GIF limit after measuring the URL", async () => {
  const media = [mediaFile("image", "https://cdn.example.com/animation.gif?version=1")];
  inspectRemoteMediaMock.mockResolvedValue({ size: 14 * 1024 * 1024, contentType: "image/gif" });

  await hydrateRemoteMediaSizesForAccounts({ media, accounts: [{ id: "x-account", platform: "x" }] });
  const validation = validateContentForPlatform("x", contentFrom(media));

  expect(validation.errors.filter((issue) => issue.code === "image_too_large")).toHaveLength(0);
});

it.each([
  ["x", "image"],
  ["x", "video"],
  ["bluesky", "image"],
  ["bluesky", "video"],
  ["facebook", "image"],
  ["facebook", "video"],
  ["instagram", "image"],
  ["instagram", "video"],
  ["linkedin", "video"],
  ["pinterest", "image"],
  ["pinterest", "video"],
  ["telegram", "image"],
  ["telegram", "video"],
  ["threads", "image"],
  ["threads", "video"],
  ["tiktok", "image"],
  ["tiktok", "video"],
  ["youtube", "video"],
] as const)("enforces the measured %s %s size limit", async (platform, type) => {
  const limit = getValidationRulesForPlatform(platform)[type]?.maxSizeBytes;
  expect(limit).toBeDefined();
  const media = [mediaFile(type)];
  inspectRemoteMediaMock.mockResolvedValue({
    size: limit! + 1,
    contentType: type === "image" ? "image/jpeg" : "video/mp4",
  });

  await hydrateRemoteMediaSizesForAccounts({
    media,
    accounts: [{ id: `${platform}-account`, platform }],
  });
  const validation = validateContentForPlatform(platform, contentFrom(media));

  expect(media[0].size).toBe(limit! + 1);
  expect(validation.errors).toContainEqual(
    expect.objectContaining({ code: `${type}_too_large`, limit, actual: limit! + 1 }),
  );
});

it("deduplicates a shared URL across accounts", async () => {
  const media = [mediaFile("image")];

  await hydrateRemoteMediaSizesForAccounts({
    media,
    accounts: [
      { id: "x-account", platform: "x" },
      { id: "telegram-account", platform: "telegram" },
    ],
  });

  expect(inspectRemoteMediaMock).toHaveBeenCalledTimes(1);
});

it("measures account override and thread media", async () => {
  const overrideMedia = mediaFile("image", "https://cdn.example.com/override.png");
  const threadMedia = mediaFile("image", "https://cdn.example.com/thread.png");

  await hydrateRemoteMediaSizesForAccounts({
    media: [],
    accounts: [{ id: "x-account", platform: "x" }],
    accountOverrides: {
      "x-account": {
        media: [overrideMedia],
        thread: [{ message: "Reply", media: [threadMedia] }],
      },
    },
  });

  expect(inspectRemoteMediaMock).toHaveBeenCalledTimes(2);
  expect(overrideMedia.size).toBe(1024);
  expect(threadMedia.size).toBe(1024);
});

it("returns structured account errors when a remote size cannot be measured", async () => {
  inspectRemoteMediaMock.mockRejectedValue(new Error("origin unavailable"));

  const result = await hydrateRemoteMediaSizesForAccounts({
    media: [mediaFile("image")],
    accounts: [{ id: "x-account", platform: "x" }],
  });

  expect(result).toContainEqual(
    expect.objectContaining({
      platform: "x",
      code: "media_unavailable",
      field: "text.media[0]",
      meta: { accountId: "x-account" },
    }),
  );
});

it.each([
  ["media thumbnail", undefined],
  ["account option thumbnail", "https://cdn.example.com/options-thumbnail.png"],
] as const)("validates a YouTube %s", async (_label, optionThumbnailUrl) => {
  const video = mediaFile("video");
  video.thumbnailUrl = "https://cdn.example.com/media-thumbnail.png";
  inspectRemoteMediaMock.mockImplementation(async (url) => ({
    size: url.includes("thumbnail") ? 2 * 1024 * 1024 + 1 : 10 * 1024,
    contentType: url.includes("thumbnail") ? "image/jpeg" : "video/mp4",
  }));

  const result = await hydrateRemoteMediaSizesForAccounts({
    media: [video],
    accounts: [{ id: "youtube-account", platform: "youtube" }],
    accountOptions: optionThumbnailUrl ? { "youtube-account": { thumbnailUrl: optionThumbnailUrl } } : undefined,
  });

  expect(result).toContainEqual(
    expect.objectContaining({
      platform: "youtube",
      code: "thumbnail_too_large",
      limit: 2 * 1024 * 1024,
      actual: 2 * 1024 * 1024 + 1,
      field: optionThumbnailUrl ? "accountOptions.youtube-account.thumbnailUrl" : "text.media[0].thumbnailUrl",
    }),
  );
  if (optionThumbnailUrl) expect(inspectRemoteMediaMock).not.toHaveBeenCalledWith(video.thumbnailUrl);
});

it.each([
  ["forem", "image"],
  ["linkedin", "image"],
] as const)("inspects %s %s media even without a size rule", async (platform, type) => {
  await hydrateRemoteMediaSizesForAccounts({
    media: [mediaFile(type)],
    accounts: [{ id: `${platform}-account`, platform }],
  });

  expect(inspectRemoteMediaMock).toHaveBeenCalledTimes(1);
});

it("validates actual image format per account even for an extensionless URL", async () => {
  inspectRemoteMediaMock.mockResolvedValue({ size: 1000, contentType: "image/png" });
  const failures = await hydrateRemoteMediaSizesForAccounts({
    media: [mediaFile("image", "https://example.com/download?id=1")],
    accounts: [
      { id: "ig", platform: "instagram" },
      { id: "x", platform: "x" },
    ],
  });
  expect(failures).toEqual([expect.objectContaining({ code: "image_format_unsupported", meta: { accountId: "ig" } })]);
  expect(inspectRemoteMediaMock).toHaveBeenCalledTimes(1);
});

it.each([
  "x",
  "facebook",
  "instagram",
  "telegram",
  "tiktok",
  "youtube",
  "bluesky",
  "threads",
  "linkedin",
  "pinterest",
  "forem",
])("rejects unavailable images for %s", async (platform) => {
  inspectRemoteMediaMock.mockRejectedValue(new Error("login page"));
  const failures = await hydrateRemoteMediaSizesForAccounts({
    media: [mediaFile("image")],
    accounts: [{ id: "account", platform }],
  });
  expect(failures).toContainEqual(
    expect.objectContaining({ code: "media_unavailable", meta: { accountId: "account" } }),
  );
});

it("reports bad thread images with their account and segment", async () => {
  inspectRemoteMediaMock.mockRejectedValue(new Error("expired"));
  const failures = await hydrateRemoteMediaSizesForAccounts({
    media: [],
    accounts: [{ id: "x", platform: "x" }],
    thread: [{ message: "reply", media: [mediaFile("image")] }],
  });
  expect(failures).toEqual([expect.objectContaining({ field: "thread[0].media[0]", meta: { accountId: "x" } })]);
});
