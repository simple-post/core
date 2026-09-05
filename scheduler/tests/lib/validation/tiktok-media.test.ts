import { unlink } from "node:fs/promises";

import { downloadToTempFile } from "@simple-post/sdk";
import sharp from "sharp";

import { validateTikTokPhotoDimensions } from "@/lib/validation/tiktok-media";

jest.mock("node:fs/promises", () => ({ unlink: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@simple-post/sdk", () => ({ downloadToTempFile: jest.fn() }));
jest.mock("sharp", () => jest.fn());
const metadata = jest.fn();
const media = [
  { id: "photo", type: "image" as const, url: "https://example.com/photo.jpg", filename: "photo.jpg", size: 1 },
];
const accounts = [{ id: "tiktok-1", platform: "tiktok" }];

beforeEach(() => {
  jest.clearAllMocks();
  (downloadToTempFile as jest.Mock).mockResolvedValue("/tmp/photo.jpg");
  (sharp as unknown as jest.Mock).mockReturnValue({ metadata });
});
it.each([
  [1080, 1920],
  [1920, 1080],
  [1080, 1080],
])("accepts %i×%i photos and cleans up", async (width, height) => {
  metadata.mockResolvedValue({ width, height });
  expect(await validateTikTokPhotoDimensions({ media, accounts })).toEqual([]);
  expect(unlink).toHaveBeenCalledWith("/tmp/photo.jpg");
});
it("rejects oversized images before TikTok submission and inspects shared URLs once", async () => {
  metadata.mockResolvedValue({ width: 4096, height: 4096 });
  const failures = await validateTikTokPhotoDimensions({
    media,
    accounts: [...accounts, { id: "tiktok-2", platform: "TikTok" }],
  });
  expect(failures).toHaveLength(2);
  expect(failures[0]).toMatchObject({
    code: "photo_dimensions_too_large",
    field: "text.media[0]",
    meta: { accountId: "tiktok-1" },
  });
  expect(downloadToTempFile).toHaveBeenCalledTimes(1);
  expect(downloadToTempFile).toHaveBeenCalledWith(media[0].url, undefined, 20 * 1024 * 1024);
});
it("inspects account overrides and blocks uninspectable images", async () => {
  metadata.mockRejectedValue(new Error("invalid image"));
  const override = [{ ...media[0], url: "https://example.com/override.jpg" }];
  const failures = await validateTikTokPhotoDimensions({
    media,
    accounts,
    accountOverrides: { "tiktok-1": { media: override } },
  });
  expect(downloadToTempFile).toHaveBeenCalledWith(override[0].url, undefined, 20 * 1024 * 1024);
  expect(failures[0].code).toBe("photo_dimensions_unavailable");
  expect(unlink).toHaveBeenCalledTimes(1);
});
it("skips other platforms and videos", async () => {
  await validateTikTokPhotoDimensions({ media, accounts: [{ id: "x", platform: "x" }] });
  await validateTikTokPhotoDimensions({ media: [{ ...media[0], type: "video" }], accounts });
  expect(downloadToTempFile).not.toHaveBeenCalled();
});
